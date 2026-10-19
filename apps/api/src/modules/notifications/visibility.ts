/**
 * ONE notification visibility rule (M30, QA 2026-10-19).
 *
 * There used to be three hand-copied versions — the list filter
 * (notification.service buildVisibilityFilter), the bulk read/unread/delete
 * filter (notification.repository buildBulkVisibilityFilter) and the per-row
 * check (notification.service assertNotificationVisible) — and they disagreed:
 * the bulk filter and the row check let a regular user act on a notification
 * whose `targetUserId` was them, while the list did not show it. `targetUserId`
 * is "the user this notification is ABOUT" (e.g. the ACCOUNT_LOCKED notice sent
 * to ADMINs names the locked user there); being its subject is not being its
 * recipient. Decision: the LIST's rule is the rule — `targetUserId` grants
 * nothing. The repository also hard-coded its own copy of the gated-type list.
 *
 * Rule:
 *  - gated types (config role lists) are visible exactly when the viewer's role
 *    is allowed for that type (`visibleGated`), whoever they are addressed to;
 *  - otherwise SUPER_ADMIN sees everything; ADMIN sees what is addressed to
 *    them, to the ADMIN role, or to nobody (system-wide), never what is
 *    addressed to SUPER_ADMIN; everyone else sees only what is addressed to them.
 */

/** Notification types whose visibility is config-driven (a role list). */
export const GATED_TYPES: Record<string, { configKey: string; field: string }> = {
  PM_SCHEDULE_QNN: { configKey: 'qnn-notifications', field: 'visibleRoles' },
  GUEST_CLEANING_REQUEST: { configKey: 'guest-cleaning-requests', field: 'recipientRoles' },
};
export const GATED_TYPE_KEYS = Object.keys(GATED_TYPES);

/** Prisma where-fragment for the NON-gated (addressing-based) rule. */
export function addressedToWhere(userRole: string | undefined, username: string | undefined): Record<string, unknown> {
  if (userRole === 'SUPER_ADMIN') return {};
  if (userRole === 'ADMIN') {
    return {
      OR: [{ forUserId: username }, { forRole: 'ADMIN' }, { forRole: null, forUserId: null }],
      // Null-safe SUPER_ADMIN exclusion: a bare NOT { forRole: 'SUPER_ADMIN' }
      // compiles to NOT (for_role = 'SUPER_ADMIN'), which is NULL — not TRUE —
      // for forRole IS NULL rows and silently drops the first and third branches.
      AND: [{ OR: [{ forRole: null }, { forRole: { not: 'SUPER_ADMIN' } }] }],
    };
  }
  // A missing username must match nothing, never everything.
  return { forUserId: username ?? '\u0000no-user\u0000' };
}

/** Full where-fragment: gated types by config, everything else by addressing. */
export function visibilityWhere(userRole: string | undefined, username: string | undefined, visibleGated: string[]): Record<string, unknown> {
  const branches: Record<string, unknown>[] = [
    { AND: [{ type: { notIn: GATED_TYPE_KEYS } }, addressedToWhere(userRole, username)] },
  ];
  for (const t of visibleGated) branches.push({ type: t });
  return { OR: branches };
}

/** Same rule for one row already loaded. */
export function isVisible(
  n: { type: string; forUserId?: string | null; forRole?: string | null },
  userRole: string | undefined,
  username: string | undefined,
  visibleGated: string[],
): boolean {
  if (GATED_TYPE_KEYS.includes(n.type)) return visibleGated.includes(n.type);
  if (userRole === 'SUPER_ADMIN') return true;
  if (userRole === 'ADMIN') {
    if (n.forRole === 'SUPER_ADMIN') return false;
    return n.forUserId === username || n.forRole === 'ADMIN' || (n.forRole == null && n.forUserId == null);
  }
  return !!username && n.forUserId === username;
}
