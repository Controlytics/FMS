/**
 * SUPER_ADMIN TOTP MFA service (S6 Option B). Enrolment + second-factor
 * verification. Completes authentication through the shared issueSession() so
 * the session/audit/notification path is identical to a normal login.
 */
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { encryptSecret, decryptSecret } from '../../lib/mfa-crypto.js';
import {
  generateMfaSecret, verifyTotp, generateBackupCodes, findUnusedBackupCode, type BackupCode,
} from '../../lib/mfa.js';
import { issueSession } from './auth.service.js';

async function requireSuperAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  if (user.role !== 'SUPER_ADMIN') throw new AppError(403, 'MFA_NOT_APPLICABLE', 'MFA applies to SUPER_ADMIN only.');
  return user;
}

export const mfaService = {
  /** Begin enrolment: generate + store an encrypted PENDING secret; return the QR URI. */
  async enrollStart(userId: string): Promise<{ otpauthUri: string; secret: string }> {
    const user = await requireSuperAdmin(userId);
    if (user.mfaEnabled) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled.');
    const { secret, otpauthUri } = generateMfaSecret(user.username);
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: encryptSecret(secret), mfaEnabled: false },
    });
    return { otpauthUri, secret };
  },

  /** Confirm an enrolment code, enable MFA, mint backup codes, and issue the session. */
  async enrollVerify(userId: string, code: string, ip: string, userAgent: string | undefined, force?: boolean) {
    const user = await requireSuperAdmin(userId);
    if (!user.mfaSecret) throw new AppError(400, 'MFA_NOT_STARTED', 'Start enrolment first.');
    const secret = decryptSecret(user.mfaSecret);
    if (!verifyTotp(secret, code)) {
      await auditLog({
        userId: user.username, userRole: user.role, action: 'MFA_FAILED',
        targetType: 'user', targetId: user.id, afterValue: { phase: 'enroll' }, ipAddress: ip, userAgent,
      });
      throw new AppError(401, 'MFA_INVALID', 'Incorrect code. Try again.');
    }
    const { plaintext, stored } = generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaEnrolledAt: new Date(), mfaBackupCodes: stored as unknown as object },
    });
    await auditLog({
      userId: user.username, userRole: user.role, action: 'MFA_ENROLLED',
      targetType: 'user', targetId: user.id,
      signatureMeaning: 'SUPER_ADMIN enrolled a TOTP authenticator (MFA)',
      ipAddress: ip, userAgent,
    });
    const session = await issueSession(user, ip, userAgent, force);
    return { ...session, backupCodes: plaintext };
  },

  /** Verify a second factor (TOTP or an unused backup code) and issue the session. */
  async verify(userId: string, code: string, ip: string, userAgent: string | undefined, force?: boolean) {
    const user = await requireSuperAdmin(userId);
    if (!user.mfaEnabled || !user.mfaSecret) throw new AppError(400, 'MFA_NOT_ENABLED', 'MFA is not enabled.');

    let method: 'totp' | 'backup' | null = null;
    let backupCodes: BackupCode[] | null = null;
    let backupIdx = -1;
    if (verifyTotp(decryptSecret(user.mfaSecret), code)) {
      method = 'totp';
    } else {
      backupCodes = (user.mfaBackupCodes as unknown as BackupCode[] | null) ?? [];
      backupIdx = findUnusedBackupCode(backupCodes, code);
      if (backupIdx >= 0) method = 'backup';
    }

    if (!method) {
      await auditLog({
        userId: user.username, userRole: user.role, action: 'MFA_FAILED',
        targetType: 'user', targetId: user.id, afterValue: { phase: 'verify' }, ipAddress: ip, userAgent,
      });
      throw new AppError(401, 'MFA_INVALID', 'Incorrect code. Try again.');
    }

    // Issue the session BEFORE consuming a backup code. issueSession throws
    // SESSION_CONFLICT (409) when another session exists and force is unset — if
    // that happened after we'd marked the code used, the user's force-retry would
    // see it as already-used and be stuck. Consuming only on success avoids that.
    const session = await issueSession(user, ip, userAgent, force);
    if (method === 'backup' && backupCodes) {
      backupCodes[backupIdx].usedAt = new Date().toISOString();
      await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: backupCodes as unknown as object } });
    }

    await auditLog({
      userId: user.username, userRole: user.role, action: 'MFA_VERIFIED',
      targetType: 'user', targetId: user.id, afterValue: { method },
      signatureMeaning: `SUPER_ADMIN passed second factor (${method})`,
      ipAddress: ip, userAgent,
    });
    return session;
  },

  /**
   * Count of remaining unused backup codes — surfaced after verify so the SA
   * knows when to regenerate. (Regeneration UI deferred.)
   */
  remainingBackupCodes(user: { mfaBackupCodes: unknown }): number {
    const codes = (user.mfaBackupCodes as BackupCode[] | null) ?? [];
    return codes.filter((c) => !c.usedAt).length;
  },
};
