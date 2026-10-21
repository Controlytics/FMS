import { prisma } from './prisma.js';

// Features SUPER_ADMIN always has on the tablet. KEEP IN STEP with FEATURES in
// web/src/routes/config/tablet-access.tsx — a key present there but missing
// here is invisible to SUPER_ADMIN.
const SUPER_ADMIN_FEATURES = [
  'login', 'filter_cleaning', 'filter_status', 'my_tasks',
  'stage_approvals', 'rfid_assign', 'logout',
];

/** Every tablet feature key a role can be granted (= what SUPER_ADMIN has). */
export const TABLET_FEATURES: ReadonlySet<string> = new Set(SUPER_ADMIN_FEATURES);

export interface TabletAccess {
  allowed: string[];
  /** true = the allowlist applies to this role; false = legacy default-allow. */
  configured: boolean;
}

/**
 * The ONE reading of `system_config['tablet-access']` for a role. Used by
 * `GET /api/config/tablet-access/my-features` and by the login itself, so the
 * tablet's view and the server's refusal cannot disagree.
 *
 * - SUPER_ADMIN: everything, never configured (cannot be locked out).
 * - Config missing or `{}`: legacy default-allow (`configured: false`).
 * - Role has its own entry: exactly that entry.
 * - Some role configured but not this one: nothing (`configured: true`).
 */
export async function resolveTabletAccess(role: string): Promise<TabletAccess> {
  if (role === 'SUPER_ADMIN') return { allowed: [...SUPER_ADMIN_FEATURES], configured: false };

  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'tablet-access' } });
  const config = (row?.configValue as Record<string, string[] | undefined> | null) ?? {};
  if (Object.prototype.hasOwnProperty.call(config, role)) {
    return { allowed: config[role] ?? [], configured: true };
  }
  if (Object.keys(config).length > 0) return { allowed: [], configured: true };
  return { allowed: [], configured: false };
}

/** May this role sign in on the tablet at all? */
export function tabletLoginAllowed(access: TabletAccess): boolean {
  return !access.configured || access.allowed.includes('login');
}
