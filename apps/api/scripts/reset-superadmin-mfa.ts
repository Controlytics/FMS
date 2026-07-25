/**
 * Host-only break-glass recovery for a SUPER_ADMIN who lost their MFA device
 * (S6 Option B). Clears the TOTP secret + backup codes so the account re-enrols
 * MFA at the next login. Writes an MFA_RESET row to the immutable audit trail.
 *
 * Like the lockout CLI, this needs local shell access to the server (the
 * DATABASE_URL from apps/api/.env) — it is not an HTTP endpoint. Combined with
 * mandatory re-enrolment, it prevents a lost authenticator from permanently
 * locking the only administrator out.
 *
 * Usage (from apps/api/):
 *   npx tsx scripts/reset-superadmin-mfa.ts              # defaults to 'superadmin'
 *   npx tsx scripts/reset-superadmin-mfa.ts <username>   # a specific SUPER_ADMIN
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { auditLog } from '../src/lib/audit.js';

async function main() {
  const username = process.argv[2] ?? 'superadmin';

  const user = await prisma.user.findFirst({ where: { username } });
  if (!user) {
    console.error(`✗ No user found with username "${username}".`);
    process.exit(1);
  }
  if (user.role !== 'SUPER_ADMIN') {
    console.error(`✗ "${username}" is ${user.role}, not SUPER_ADMIN. MFA applies to SUPER_ADMIN only.`);
    process.exit(1);
  }
  if (!user.mfaEnabled && !user.mfaSecret) {
    console.log(`✓ "${username}" has no MFA configured. Nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null, mfaEnrolledAt: null, mfaBackupCodes: undefined },
  });
  await prisma.userSession.updateMany({ where: { userId: user.id, isActive: true }, data: { isActive: false } });

  await auditLog({
    userId: username,
    userRole: 'SUPER_ADMIN',
    action: 'MFA_RESET',
    targetType: 'user',
    targetId: user.id,
    reason: 'Host-only break-glass MFA reset via scripts/reset-superadmin-mfa.ts',
    signatureMeaning: 'SUPER_ADMIN MFA cleared by an operator with local server access (lost-device recovery)',
  });

  console.log(`✓ Cleared MFA for SUPER_ADMIN "${username}". They will re-enrol an authenticator at next login.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('✗ MFA reset failed:', e?.message ?? e);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
