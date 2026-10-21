/**
 * Custom error classes for service-layer error handling.
 * Route handlers (or a global error handler) catch these and map to HTTP responses.
 */

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: string = 'CONFLICT', details?: unknown) {
    super(409, code, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, 'FORBIDDEN', message);
  }
}

/**
 * QA Phase 5 (P5-03, 2026-10-21): a PrismaClientUnknownRequestError has no P-code,
 * so it fell to the 500 + SYSTEM_ERROR path even when the CLIENT's value was the
 * problem. Two live causes: a NUL byte in a string (Postgres 22021 - text cannot
 * hold 0x00) and an integer outside INT4 (a driver ConversionError before the
 * query is sent). Both are bad input -> 400. Only Postgres class 22 ("data
 * exception") and the driver's ConversionError qualify; any other unknown
 * request error (connection loss, a real bug) stays a 500.
 */
export function isClientDataPrismaError(err: unknown): boolean {
  if ((err as { name?: string })?.name !== 'PrismaClientUnknownRequestError') return false;
  const msg = String((err as { message?: string }).message ?? '');
  return /PostgresError \{ code: "22[0-9A-Z]{3}"/.test(msg) || /ConversionError\(/.test(msg);
}

/**
 * QA Phase 4, P4-09 (2026-10-21): a Fastify / Fastify-plugin CLIENT error with no
 * explicit mapping (e.g. @fastify/multipart's 406 FST_INVALID_MULTIPART_CONTENT_TYPE
 * when JSON is posted to an upload route) fell to the catch-all: answered
 * `INTERNAL_ERROR` with a 4xx status, logged as "Unhandled error" and paged the
 * admins with a SYSTEM_ERROR notification. A 4xx `FST_*` error is the client's
 * mistake; its message is Fastify's own fixed text (no paths, no data). Returns
 * the response to send, or null when the error is not one of these.
 */
export function fastifyClientError(err: unknown): { status: number; body: { error: string; message: string } } | null {
  const e = err as { statusCode?: unknown; code?: unknown; message?: unknown };
  const status = typeof e?.statusCode === 'number' ? e.statusCode : 0;
  if (status < 400 || status > 499) return null;
  if (typeof e.code !== 'string' || !e.code.startsWith('FST_')) return null;
  const message = typeof e.message === 'string' && e.message ? e.message.slice(0, 300) : 'The request is not valid.';
  return { status, body: { error: 'INVALID_REQUEST', message } };
}
