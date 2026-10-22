/**
 * Tablet access allowlist — ONE rule for both tablet pages (OQ-04, 2026-10-19).
 *
 * Two problems this file closes:
 *
 * 1. FAIL-OPEN OFFLINE. `/api/config/tablet-access/my-features` was only
 *    fetched while online, so offline both pages saw "no config" and allowed
 *    every feature to every role. The last list read online is now cached in
 *    IndexedDB per USER (tablets are shared — one operator's list must never
 *    apply to the next) and used while offline. If this user never had a list
 *    cached on this tablet, behaviour is unchanged (no config = everything
 *    allowed); the login screen already refuses a role without tablet access
 *    before a session exists, so that case needs an earlier ONLINE login by
 *    the same user to arise at all.
 *
 * 2. TWO RULES. mobile-wrapper used the server's `configured` flag;
 *    mobile-operations used "empty list = everything allowed", which let a role
 *    configured with an EMPTY allowlist through. Both now use
 *    `tabletFeatureAllowed` below.
 *
 * Also: the Stage Approvals tab (OQ-03a). The tablet feature list and RBAC are
 * separate gates. OPERATOR / SUPERVISOR carry `stage_approvals` in the
 * tablet-access config while their roles hold no STAGE_APPROVAL_* permission,
 * so the tab opened onto an endpoint that answers 403. Showing it needs BOTH.
 */
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { PERMISSIONS } from '@digilog/shared';
import { cacheData, getCachedData } from '@/lib/offline-store';

export interface TabletAccessResponse {
  allowed?: string[];
  configured?: boolean;
  role?: string;
}

/** Long on purpose: offline reads ignore expiry anyway; this only matters online. */
const TABLET_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const tabletAccessCacheKey = (userId: string) => `tablet-access-${userId}`;

/**
 * THE allowlist rule. No response, or a role the admin never configured →
 * allowed (backwards compatible). A configured role → only what is listed,
 * an empty list included.
 */
export function tabletFeatureAllowed(access: TabletAccessResponse | null | undefined, feature: string): boolean {
  if (!access || access.configured !== true) return true;
  return Array.isArray(access.allowed) && access.allowed.includes(feature);
}

/** Stage Approvals needs the tablet feature AND the RBAC permission (SUPER_ADMIN bypasses). */
export function canUseStageApprovals(
  access: TabletAccessResponse | null | undefined,
  user: { role?: string; permissions?: string[] } | null | undefined,
): boolean {
  if (!tabletFeatureAllowed(access, 'stage_approvals')) return false;
  if (user?.role === 'SUPER_ADMIN') return true;
  const perms = user?.permissions ?? [];
  return perms.includes(PERMISSIONS.STAGE_APPROVAL_VIEW) || perms.includes(PERMISSIONS.STAGE_APPROVAL_DECIDE);
}

/**
 * The list in force: the live answer when there is one, else the last list this
 * user read online on this tablet. Deliberately NOT keyed on the `online` flag
 * — on Android WebViews it can read "online" while the server is unreachable,
 * and keying on it left `live` undefined and every feature allowed.
 */
export function pickTabletAccess(
  live: TabletAccessResponse | null | undefined,
  cached: TabletAccessResponse | null | undefined,
): TabletAccessResponse | undefined {
  return live ?? cached ?? undefined;
}

export function useTabletAccess(user: { id?: string } | null | undefined, online: boolean) {
  const userId = user?.id;
  const { data: live } = useSWR<TabletAccessResponse>(user && online ? '/api/config/tablet-access/my-features' : null);
  const [cached, setCached] = useState<{ userId: string; value: TabletAccessResponse } | null>(null);

  // Remember the last list read online, for this user — in memory at once, as
  // well as on disk (2026-10-22). Going offline drops `live`, and until the disk
  // read below resolved there was NO list in force: every feature was allowed
  // (fail-open) and a role the tablet is not enabled for saw the shell flash up.
  useEffect(() => {
    if (!userId || !live) return;
    setCached({ userId, value: live });
    cacheData(tabletAccessCacheKey(userId), live, TABLET_ACCESS_TTL_MS).catch(() => { /* best effort */ });
  }, [userId, live]);

  // Read it back for this user (never another user's row — the key carries the
  // id). Whenever the user changes or connectivity flips, not only when the flag
  // says offline: the flag is not trustworthy on the tablet.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getCachedData<TabletAccessResponse>(tabletAccessCacheKey(userId))
      .then((v) => { if (alive && v) setCached({ userId, value: v }); })
      .catch(() => { /* nothing cached → unchanged behaviour */ });
    return () => { alive = false; };
  }, [userId, online]);

  const fromCache = cached && cached.userId === userId ? cached.value : undefined;
  const tabletAccess = pickTabletAccess(live, fromCache);
  const allowedFeatures: string[] = tabletAccess?.allowed ?? [];
  const tabletConfigured = tabletAccess?.configured === true;
  return {
    tabletAccess,
    allowedFeatures,
    tabletConfigured,
    /** True when the list in force came from this tablet's cache (offline). */
    fromOfflineCache: !live && !!tabletAccess,
    hasFeature: (f: string) => tabletFeatureAllowed(tabletAccess, f),
  };
}
