import { AppError } from './errors.js';

/**
 * QA Phase 4, P4-10 (2026-10-21): a change to what a role may DO is a §11
 * decision, and decisions carry a reason. Role-permission saves
 * (PUT /api/config/roles/:role, PUT /api/config/users/:userId, PUT /api/roles/:name)
 * wrote their audit row with reason = NULL. Called only when the request
 * actually changes permissions (or a role's hierarchy level); cosmetic edits
 * (colour, display name, sidebar) stay reason-free.
 */
export const MIN_CHANGE_REASON = 5;
export const MAX_CHANGE_REASON = 500;

export const changeReasonSchemaProp = {
  reason: { type: 'string', maxLength: MAX_CHANGE_REASON, description: `Why the permissions are changing (at least ${MIN_CHANGE_REASON} characters). Required when permissions change; recorded on the audit row.` },
} as const;

export function requireChangeReason(body: unknown): string {
  const raw = (body as { reason?: unknown } | null)?.reason;
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < MIN_CHANGE_REASON) {
    throw new AppError(400, 'REASON_REQUIRED', `A reason of at least ${MIN_CHANGE_REASON} characters is required when changing permissions — it is recorded in the audit trail.`);
  }
  if (reason.length > MAX_CHANGE_REASON) {
    throw new AppError(400, 'REASON_TOO_LONG', `Reason must be ${MAX_CHANGE_REASON} characters or fewer.`);
  }
  return reason;
}
