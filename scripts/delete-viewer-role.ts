/**
 * One-off: delete the VIEWER role via the proper service path so the deletion
 * is audit-logged (21 CFR hash chain) and its role_configs row is cleaned up
 * (no orphan left behind). User-authorized 2026-06-15.
 *
 * Run:  cd apps/api && npx tsx ../../scripts/delete-viewer-role.ts
 */
import { prisma } from '../apps/api/src/lib/prisma.js';
import { roleService } from '../apps/api/src/modules/roles/role.service.js';

const ctx = {
  userId: 'superadmin',
  userSub: 'superadmin',
  userRole: 'SUPER_ADMIN',
  ipAddress: '127.0.0.1',
  userAgent: 'delete-viewer-script',
  sessionId: 'manual-cleanup',
} as any;

async function main() {
  const before = await prisma.role.findUnique({ where: { name: 'VIEWER' }, select: { name: true } });
  if (!before) { console.log('VIEWER does not exist — nothing to delete.'); return; }

  const users = await prisma.user.count({ where: { role: 'VIEWER' } });
  if (users > 0) { console.log(`Refusing: VIEWER still has ${users} user(s). Reassign them first.`); return; }

  await roleService.delete('VIEWER', ctx);

  const after = await prisma.role.findUnique({ where: { name: 'VIEWER' }, select: { name: true } });
  const cfg = await prisma.roleConfig.findUnique({ where: { role: 'VIEWER' }, select: { role: true } });
  console.log(`VIEWER role deleted: ${after ? 'STILL PRESENT (FAILED)' : 'gone ✓'}`);
  console.log(`VIEWER role_config:  ${cfg ? 'STILL PRESENT (orphan!)' : 'cleaned ✓'}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
