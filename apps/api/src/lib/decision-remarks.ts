import type { FastifyReply } from 'fastify';
import { AppError } from './errors.js';

/**
 * Approval/decision flows require remarks (CLAUDE.md) - a review or an approval
 * says why as much as a rejection does (D03-13, 2026-10-22). One bar for the PM
 * schedule, Replacement Schedule and cleaning-stage decisions: at least 3
 * characters once trimmed, the bar their rejections already had.
 *
 * A route checks it BEFORE its re-auth gate (`refuseWithoutDecisionRemarks`), so
 * a decision that will be refused for having no reason costs no signature; the
 * service checks it again (`requireDecisionRemarks`) for any other caller.
 */
export const DECISION_REMARKS_MIN = 3;
export const DECISION_REMARKS_MESSAGE = `Remarks are required (at least ${DECISION_REMARKS_MIN} characters).`;

export function hasDecisionRemarks(remarks: unknown): remarks is string {
  return typeof remarks === 'string' && remarks.trim().length >= DECISION_REMARKS_MIN;
}

/** Answers 400 VALIDATION and returns true when the remarks are missing or too short. */
export function refuseWithoutDecisionRemarks(remarks: unknown, reply: FastifyReply): boolean {
  if (hasDecisionRemarks(remarks)) return false;
  reply.code(400).send({ error: 'VALIDATION', message: DECISION_REMARKS_MESSAGE });
  return true;
}

/** The trimmed remarks, or 400 REMARKS_REQUIRED. */
export function requireDecisionRemarks(remarks: unknown): string {
  if (!hasDecisionRemarks(remarks)) throw new AppError(400, 'REMARKS_REQUIRED', DECISION_REMARKS_MESSAGE);
  return remarks.trim();
}
