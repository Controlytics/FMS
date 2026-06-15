/**
 * One-time backfill (2026-06-15): apply the sidebar↔permission link to roles
 * that were configured BEFORE the link existed. For each role that already has
 * a saved sidebar config, replay configService.updateRoleConfig with its current
 * sidebarItems — which grants each enabled item's primary permission and syncs
 * the QNN report into qnn-notifications.visibleRoles. Additive + idempotent:
 * safe to run more than once; it never removes a permission or a sidebar item.
 *
 * Run:  cd apps/api && npx tsx ../../scripts/backfill-sidebar-permission-link.ts
 */
import { prisma } from '../apps/api/src/lib/prisma.js';
import { configService } from '../apps/api/src/modules/config/config.service.js';

const ctx = {
  userId: 'system-backfill',
  userSub: 'system',
  userRole: 'SUPER_ADMIN',
  ipAddress: '127.0.0.1',
  userAgent: 'backfill-script',
  sessionId: 'backfill',
} as any;

async function main() {
  const configs = await prisma.roleConfig.findMany();
  for (const cfg of configs) {
    const role = cfg.role as unknown as string;
    if (role === 'SUPER_ADMIN') continue;
    const sidebarItems = (cfg.sidebarItems as string[] | null) ?? [];
    if (sidebarItems.length === 0) continue;

    const before = await prisma.role.findFirst({ where: { name: role }, select: { permissions: true } });
    const beforePerms = (before?.permissions as string[] | undefined) ?? [];

    // Replay through the service so the link + QNN sync + audit all run.
    await configService.updateRoleConfig(role, { sidebarItems }, ctx);

    const after = await prisma.role.findFirst({ where: { name: role }, select: { permissions: true } });
    const afterPerms = (after?.permissions as string[] | undefined) ?? [];
    const added = afterPerms.filter(p => !beforePerms.includes(p));
    console.log(`${role.padEnd(14)} sidebar=${sidebarItems.length} items · perms ${beforePerms.length}→${afterPerms.length}${added.length ? ` · +[${added.join(', ')}]` : ' · (no change)'}`);
  }

  const qnn = await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } });
  console.log('\nqnn-notifications.visibleRoles =', JSON.stringify((qnn?.configValue as any)?.visibleRoles));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
