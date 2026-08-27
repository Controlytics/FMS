/**
 * Who may SEE which audit rows.
 *
 * Two independent rules, both enforced here so every read path shares one
 * definition instead of re-deriving it:
 *
 *  1. **Actor rule** (pre-existing) — a non-SUPER_ADMIN never sees rows written
 *     BY a SUPER_ADMIN. Stops a lower role reading the platform owner's
 *     activity out of the accountability record.
 *
 *  2. **Action rule** (2026-08-27) — a non-SUPER_ADMIN never sees rows whose
 *     ACTION belongs to the super-admin data console, whoever wrote them.
 *
 * Rule 2 exists because rule 1 alone is incidental: it protects the Filter Data
 * Management rows only for as long as a SUPER_ADMIN is the one performing them.
 * The console is `requireRole('SUPER_ADMIN')` today, so in practice that holds —
 * but its config card is delegable (`EXPLICIT_GRANT_KEYS`), and the day someone
 * opens the backend to a delegated role, every manual edit to cleaning history
 * would silently become readable by every role that holds `AUDIT_READ` (which is
 * all of them). Naming the actions makes the restriction a property of the
 * record rather than a side effect of who happened to click the button.
 *
 * These rows are the record of a human hand-editing operational history — who
 * changed what, from what, to what, and why. That is exactly the material an
 * inspector wants and exactly the material a non-owner should not be browsing.
 *
 * NOTE this governs VISIBILITY, not existence. The rows are always written, the
 * hash chain always covers them, and a backup always contains them. A hidden row
 * is hidden, never absent.
 */

/**
 * Actions emitted by Config → Filter Data Management and by audit-record
 * management. Visible to SUPER_ADMIN only.
 *
 * Deliberately NOT included: `FILTER_RETIRED` / `FILTER_REPLACED` written by the
 * manual-create paths. Those are ordinary operational records — they drive the
 * Retirement and Replacement lists that operators are meant to read, and hiding
 * them would blank those pages for everyone else. The `MANUAL_RECORD_CREATED`
 * marker written alongside each one carries the "a human keyed this in" fact,
 * and that marker IS restricted.
 */
export const SUPER_ADMIN_ONLY_AUDIT_ACTIONS = [
  'MANUAL_RECORD_CREATED',
  'MANUAL_RECORD_UPDATED',
  'MANUAL_RECORD_DELETED',
  'AUDIT_RECORD_UPDATED',
  'AUDIT_RECORD_DELETED',
  'AUDIT_RECORDS_BULK_DELETED',
  'AUDIT_RECORD_REDACTED',
  'AUDIT_RECORDS_BULK_REDACTED',
  // 2026-08-27: the offline-replay grant row is no longer emitted at all (the
  // write was removed from POST /api/auth/offline-grant). The 1,585 historic
  // rows still exist and still render — restricted here so they stop filling
  // every operator's audit page, while a SUPER_ADMIN can still answer "who held
  // an offline-replay window" for the period before the write was removed.
  'GRANT_OFFLINE_REPLAY',
] as const;

/**
 * Prisma `where` fragment restricting a read to what `role` may see.
 * Returns `null` for SUPER_ADMIN — a complete, unfiltered §11 trail.
 *
 * Spread into an `AND` array, or use as one branch of an existing `AND`:
 *
 *   const scope = auditVisibilityScope(req.user.role);
 *   const where = { AND: [ ...(scope ? [scope] : []), ...otherFilters ] };
 */
export function auditVisibilityScope(role: string | undefined): Record<string, unknown> | null {
  if (role === 'SUPER_ADMIN') return null;
  return {
    AND: [
      // Rule 1 — not written by a SUPER_ADMIN. `userRole: null` is allowed
      // through: system-emitted rows (cron sweeps, boot) carry no role and are
      // not anybody's private activity.
      { OR: [{ userRole: { not: 'SUPER_ADMIN' } }, { userRole: null }] },
      // Rule 2 — not a super-admin-console action, regardless of author.
      { action: { notIn: [...SUPER_ADMIN_ONLY_AUDIT_ACTIONS] } },
    ],
  };
}
