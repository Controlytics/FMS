import { prisma } from '../../lib/prisma.js';
import { DB_TABLES, type BackupData } from './backup.helpers.js';

// ---------------------------------------------------------------------------
// Raw SQL fetch (used for SQL and CSV exports — returns actual DB column names)
// ---------------------------------------------------------------------------

export async function fetchAllTablesRaw(): Promise<Record<string, Record<string, any>[]>> {
  const result: Record<string, Record<string, any>[]> = {};
  for (const table of DB_TABLES) {
    const orderClause = table === 'audit_trail' ? ' ORDER BY id ASC' : '';
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${table}"${orderClause}`,
    ) as Record<string, any>[];
    result[table] = rows;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prisma-based fetch (used for JSON and BAK exports — Prisma model keys)
// ---------------------------------------------------------------------------

export async function fetchAllTablesPrisma(): Promise<Record<string, any[]>> {
  const [
    users, roles, systemConfig, auditTrail,
    notifications, passwordHistory, sessions, fieldIdConfig,
    userConfigs, roleConfigs, passwordResetRequests,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.role.findMany(),
    prisma.systemConfig.findMany(),
    prisma.auditTrail.findMany({ orderBy: { id: 'asc' } }),
    prisma.notification.findMany(),
    prisma.passwordHistory.findMany(),
    prisma.session.findMany(),
    prisma.fieldIdConfig.findMany(),
    prisma.userConfig.findMany(),
    prisma.roleConfig.findMany(),
    prisma.passwordResetRequest.findMany(),
  ]);

  return {
    users, roles, systemConfig, auditTrail,
    notifications, passwordHistory, sessions, fieldIdConfig,
    userConfigs, roleConfigs, passwordResetRequests,
  } as Record<string, any[]>;
}

// ---------------------------------------------------------------------------
// Restore transaction — delete all + insert all, respecting FK order
// ---------------------------------------------------------------------------

export async function restoreFromBackup(backup: BackupData): Promise<void> {
  await prisma.$transaction(async (tx: any) => {
    // Temporarily disable audit_trail immutability triggers for restore (if they exist)
    const triggers: any[] = await tx.$queryRawUnsafe(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = '"audit_trail"'::regclass AND tgname IN ('audit_trail_no_update', 'audit_trail_no_delete')`
    );
    for (const t of triggers) {
      await tx.$executeRawUnsafe(`ALTER TABLE "audit_trail" DISABLE TRIGGER "${t.tgname}"`);
    }

    // Delete in reverse dependency order
    await tx.notification.deleteMany();
    await tx.passwordResetRequest.deleteMany();
    await tx.userConfig.deleteMany();
    await tx.roleConfig.deleteMany();
    await tx.fieldIdConfig.deleteMany();
    await tx.session.deleteMany();
    await tx.passwordHistory.deleteMany();
    await tx.auditTrail.deleteMany();
    await tx.systemConfig.deleteMany();
    await tx.user.deleteMany();
    await tx.role.deleteMany();

    // Insert in dependency order
    if (backup.data.roles?.length)
      await tx.role.createMany({ data: backup.data.roles });
    if (backup.data.users?.length)
      await tx.user.createMany({ data: backup.data.users });
    if (backup.data.systemConfig?.length)
      await tx.systemConfig.createMany({ data: backup.data.systemConfig });
    if (backup.data.fieldIdConfig?.length)
      await tx.fieldIdConfig.createMany({ data: backup.data.fieldIdConfig });
    if (backup.data.passwordHistory?.length)
      await tx.passwordHistory.createMany({ data: backup.data.passwordHistory });
    if (backup.data.sessions?.length)
      await tx.session.createMany({ data: backup.data.sessions });
    if (backup.data.passwordResetRequests?.length)
      await tx.passwordResetRequest.createMany({ data: backup.data.passwordResetRequests });
    if (backup.data.userConfigs?.length)
      await tx.userConfig.createMany({ data: backup.data.userConfigs });
    if (backup.data.roleConfigs?.length)
      await tx.roleConfig.createMany({ data: backup.data.roleConfigs });
    if (backup.data.notifications?.length)
      await tx.notification.createMany({ data: backup.data.notifications });
    if (backup.data.auditTrail?.length)
      await tx.auditTrail.createMany({ data: backup.data.auditTrail });

    // Re-enable audit_trail immutability triggers (if they exist)
    for (const t of triggers) {
      await tx.$executeRawUnsafe(`ALTER TABLE "audit_trail" ENABLE TRIGGER "${t.tgname}"`);
    }
  });
}

// ---------------------------------------------------------------------------
// Reset auto-increment sequence for audit_trail after restore
// ---------------------------------------------------------------------------

export async function resetAuditSequence(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('audit_trail', 'id'), COALESCE((SELECT MAX(id) FROM audit_trail), 0) + 1, false)`,
  );
}
