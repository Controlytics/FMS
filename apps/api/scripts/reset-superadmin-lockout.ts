/**
 * Host-only break-glass recovery for a locked-out SUPER_ADMIN (S6, 2026-07-25).
 *
 * Since S6 made SUPER_ADMIN subject to account lockout like every other user, a
 * PERMANENT-lockout policy could otherwise leave the only administrator unable to
 * log in with no way back. This script is that safety net: it clears the lockout
 * WITHOUT changing the password (the legitimate admin's password is still valid —
 * an attacker's failed guesses are what tripped the lock), and writes an
 * ACCOUNT_UNLOCKED row to the immutable, hash-chained audit trail so the recovery
 * is itself on the record.
 *
 * It can ONLY be run by someone with local shell access to the server (it needs the
 * server's DATABASE_URL from apps/api/.env) — it is not an HTTP endpoint. That is
 * the whole point: online attackers can't reach it.
 *
 * Usage (from apps/api/):
 *   npx tsx scripts/reset-superadmin-lockout.ts              # defaults to 'superadmin'
 *   npx tsx scripts/reset-superadmin-lockout.ts <username>   # a specific SUPER_ADMIN
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
    console.error(`✗ "${username}" is ${user.role}, not SUPER_ADMIN. Use the admin UI (Users → Unlock) for non-SUPER_ADMIN accounts.`);
    process.exit(1);
  }

  const wasLocked = user.status === 'LOCKED' || user.failedLoginAttempts > 0 || user.lockoutUntil != null;
  if (!wasLocked) {
    console.log(`✓ "${username}" is not locked (status=${user.status}, failedAttempts=${user.failedLoginAttempts}). Nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: user.status === 'LOCKED' ? 'ENABLED' : user.status,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      lockedAt: null,
    },
  });

  // Also terminate any lingering sessions so recovery starts clean.
  await prisma.userSession.updateMany({
    where: { userId: user.id, isActive: true },
    data: { isActive: false },
  });

  await auditLog({
    userId: username,
    userRole: 'SUPER_ADMIN',
    action: 'ACCOUNT_UNLOCKED',
    targetType: 'user',
    targetId: user.id,
    beforeValue: { status: user.status, failedLoginAttempts: user.failedLoginAttempts, lockoutUntil: user.lockoutUntil },
    afterValue: { status: 'ENABLED', failedLoginAttempts: 0, lockoutUntil: null },
    reason: 'Host-only break-glass recovery via scripts/reset-superadmin-lockout.ts',
    signatureMeaning: 'SUPER_ADMIN lockout cleared by an operator with local server access (S6 recovery CLI)',
  });

  console.log(`✓ Cleared lockout for SUPER_ADMIN "${username}". They can log in with their existing password.`);
  console.log('  (An ACCOUNT_UNLOCKED audit row was written; consider rotating the SA password if the lock was caused by an attack.)');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('✗ Recovery failed:', e?.message ?? e);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
