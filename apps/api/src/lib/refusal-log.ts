/**
 * Why a request was refused — for the HTTP log line (2026-10-01).
 *
 * The http / error logs recorded a refusal as its status alone:
 *
 *     POST /api/filters/<id>/start-cycle → 409
 *
 * Six different rules answer 409 on that one route (overdue replacement, an
 * earlier PM not carried out, block change, cycle already active, …), so the
 * line said THAT the start was refused and not WHY. Diagnosing the tablet's
 * "No active cleaning cycle" report meant ruling the rules out one at a time
 * against live data.
 *
 * Read from the response BODY in an `onSend` hook rather than from the error
 * handler, because most refusals never reach the error handler: the auth, rbac
 * and re-auth gates answer with `reply.code(4xx).send({ error, message })`
 * directly. The body is the one place every refusal passes through.
 *
 * Only `error` and `message` are taken — both were already sent to the client.
 * `details` is NOT logged: it can carry a list of records (pending PM visits,
 * validation issues) and the log line must stay one line.
 */

export interface Refusal {
  /** The stable machine code, e.g. `PM_PREVIOUS_TASK_PENDING`. */
  errorCode?: string;
  /** The operator-facing sentence that went with it. */
  errorMessage?: string;
}

/** Longest message kept on the log line; the formatter also caps values. */
const MAX_MESSAGE_LEN = 240;

/**
 * Pull the refusal out of a serialized error response.
 *
 * Returns null when there is nothing usable: a non-string payload (stream,
 * buffer), a body that is not JSON, or JSON with neither field. Never throws —
 * a logging helper must not be able to fail a response.
 */
export function extractRefusal(payload: unknown): Refusal | null {
  if (typeof payload !== 'string' || payload.length === 0 || payload[0] !== '{') return null;
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const { error, message } = body as { error?: unknown; message?: unknown };
  const out: Refusal = {};
  if (typeof error === 'string' && error.length > 0) out.errorCode = error.slice(0, 80);
  if (typeof message === 'string' && message.length > 0) {
    out.errorMessage = message.length > MAX_MESSAGE_LEN ? `${message.slice(0, MAX_MESSAGE_LEN)}…` : message;
  }
  return out.errorCode || out.errorMessage ? out : null;
}
