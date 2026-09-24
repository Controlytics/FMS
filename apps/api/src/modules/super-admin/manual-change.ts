import type { FastifyRequest, FastifyReply } from 'fastify';
import { enforceReauth } from '../../lib/reauth-check.js';
import { auditLog, type AuditTx } from '../../lib/audit.js';

/**
 * Shared pieces of the SUPER_ADMIN manual-change contract (2026-08-27 audit
 * retrofit), pulled out of routes.ts on 2026-09-05 so the user-facing page
 * edits (record-edit-routes.ts) run under EXACTLY the same rules as the
 * Filter Data Management console: SUPER_ADMIN_DATA_EDIT re-auth, a
 * `_changeReason` of at least MIN_REASON_LEN, and one audit row per change.
 */
export async function requireDataEditReauth(req: FastifyRequest, reply: FastifyReply) {
  const { ok } = await enforceReauth('SUPER_ADMIN_DATA_EDIT', req, reply);
  if (!ok) {
    // enforceReauth has already sent the 401 response â€” Fastify stops
    // the preHandler chain on send. Returning is sufficient.
    return;
  }
}

/**
 * Mandatory justification on every manual data change (21 CFR § 11.10(e): the
 * record must say WHY, not just who and what).
 *
 * Body key is `_changeReason` — underscore-prefixed like `_currentPassword`
 * so it never collides with a real column. `BlockChangeRequest.reason` is a
 * live field on one of the edited tables; sharing the key would silently
 * overwrite it with the operator's justification.
 */
export const MIN_REASON_LEN = 5;
export const MAX_REASON_LEN = 500;
/** Spread into any mutation body schema so the field is documented + bounded. */
export const reasonSchemaProps = {
  _changeReason: { type: 'string', minLength: MIN_REASON_LEN, maxLength: MAX_REASON_LEN, description: 'Why this manual change is being made. Recorded on the audit row.' },
};
export function readChangeReason(req: FastifyRequest, reply: FastifyReply): string | null {
  const raw = (req.body as any)?._changeReason;
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < MIN_REASON_LEN) {
    reply.code(400).send({
      error: 'REASON_REQUIRED',
      message: `A reason of at least ${MIN_REASON_LEN} characters is required — manual data changes are recorded in the audit trail.`,
    });
    return null;
  }
  if (reason.length > MAX_REASON_LEN) {
    reply.code(400).send({ error: 'REASON_TOO_LONG', message: `Reason must be ${MAX_REASON_LEN} characters or fewer.` });
    return null;
  }
  return reason;
}

export type ManualVerb = 'CREATED' | 'UPDATED' | 'DELETED';

/**
 * Write the audit row for one manual data change.
 *
 * `targetType` is snake_case and drives BOTH the stored row and the rendered
 * description — `audit-helpers.ts` resolves the `{recordType}` placeholder
 * from it (cleaning_cycle → "Cleaning Cycle"), which is why three generic
 * MANUAL_RECORD_* actions still read specifically on the audit page.
 *
 * Pass `tx` to join the caller's transaction so the data write and its audit
 * row commit or roll back together.
 */
export async function auditManualChange(
  req: FastifyRequest,
  opts: {
    verb: ManualVerb;
    targetType: string;
    targetId: string;
    label: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    /** Extra context the row itself doesn't carry (e.g. cascaded deletes). */
    sideEffects?: Record<string, unknown>;
  },
  tx?: AuditTx,
): Promise<void> {
  const u = req.user as any;
  const verbWord = opts.verb === 'CREATED' ? 'created' : opts.verb === 'UPDATED' ? 'edited' : 'deleted';
  await auditLog({
    userId: u?.username, // Audit 2026-09-24 (compliance F3): actor column is the username everywhere else
    userName: u?.username,
    userRole: u?.role,
    action: `MANUAL_RECORD_${opts.verb}`,
    targetType: opts.targetType,
    targetId: opts.targetId,
    beforeValue: opts.before ? sanitizeSnapshot(opts.before) : undefined,
    afterValue: opts.sideEffects
      ? { ...(opts.after ? sanitizeSnapshot(opts.after) as object : {}), _sideEffects: opts.sideEffects }
      : opts.after ? sanitizeSnapshot(opts.after) : undefined,
    reason: opts.reason,
    signatureMeaning: `${opts.label} manually ${verbWord} via Filter Data Management`,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    sessionId: u?.sessionId,
  }, tx);
}

/**
 * Prisma rows carry Date and BigInt values; `auditLog` JSON-stringifies the
 * snapshots and BigInt has no JSON representation (it throws). Normalise both
 * so a snapshot of any table can go into before/afterValue unchanged.
 */
export function sanitizeSnapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    return v;
  }));
}

