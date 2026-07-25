/**
 * TOTP core + backup codes for SUPER_ADMIN MFA (S6 Option B).
 * Pure-JS (otplib) — no network, works fully offline. TOTP is clock-based:
 * server and authenticator-device clocks must be within ~±30s (window ±1 step).
 */
import { authenticator } from 'otplib';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Allow ±1 time-step (30s) of clock skew between server and the phone.
authenticator.options = { window: 1 };

const ISSUER = 'DigiLog';

export interface BackupCode {
  hash: string;      // sha256 hex of the plaintext code
  usedAt: string | null;
}

/** New base32 TOTP secret + the otpauth:// URI to render as a QR. */
export function generateMfaSecret(username: string): { secret: string; otpauthUri: string } {
  const secret = authenticator.generateSecret();
  const otpauthUri = authenticator.keyuri(username, ISSUER, secret);
  return { secret, otpauthUri };
}

/** Verify a 6-digit TOTP code against the (decrypted) base32 secret. */
export function verifyTotp(secret: string, token: string): boolean {
  const t = (token ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  try {
    return authenticator.verify({ token: t, secret });
  } catch {
    return false;
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Generate N single-use backup codes (plaintext, shown once) + their stored hashes. */
export function generateBackupCodes(count = 10): { plaintext: string[]; stored: BackupCode[] } {
  const plaintext: string[] = [];
  const stored: BackupCode[] = [];
  for (let i = 0; i < count; i++) {
    // 8 hex chars grouped xxxx-xxxx — easy to read/type, ~4 billion space each.
    const raw = randomBytes(4).toString('hex');
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plaintext.push(code);
    stored.push({ hash: hashCode(code), usedAt: null });
  }
  return { plaintext, stored };
}

/**
 * Verify a backup code against the stored list. Returns the index of a matching
 * UNUSED code (constant-time compare per candidate), or -1. Caller marks it used.
 */
export function findUnusedBackupCode(codes: BackupCode[], input: string): number {
  const normalized = (input ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{4}-[0-9a-f]{4}$/.test(normalized)) return -1;
  const inputHash = Buffer.from(hashCode(normalized), 'hex');
  for (let i = 0; i < codes.length; i++) {
    if (codes[i].usedAt) continue;
    const stored = Buffer.from(codes[i].hash, 'hex');
    if (stored.length === inputHash.length && timingSafeEqual(stored, inputHash)) return i;
  }
  return -1;
}
