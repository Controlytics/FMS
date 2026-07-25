/**
 * AES-256-GCM encryption for TOTP MFA secrets at rest (S6 Option B).
 *
 * The TOTP shared secret is the whole ballgame — anyone who reads it can mint
 * valid codes forever. Storing it plaintext in `users.mfa_secret` would mean a DB
 * or backup leak silently defeats MFA (and would itself be an at-rest-secret
 * finding). So we envelope-encrypt it.
 *
 * KEY STABILITY IS CRITICAL: unlike the per-process offline-replay secret, this
 * key MUST be stable across restarts, or every enrolled SUPER_ADMIN's secret
 * becomes undecryptable and they can't pass MFA. Prod requires an explicit
 * `MFA_ENC_KEY`; dev derives a STABLE key from `JWT_SECRET` (no random tail),
 * domain-separated so a JWT leak alone doesn't expose MFA secrets.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function getKey(): Buffer {
  const explicit = process.env.MFA_ENC_KEY;
  if (explicit && explicit.length >= 32) {
    // Normalize any-length key material to exactly 32 bytes.
    return createHash('sha256').update(explicit).digest();
  }
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new Error('FATAL: MFA_ENC_KEY must be set (>=32 chars) in production/staging to encrypt MFA secrets at rest.');
  }
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret && jwtSecret.length >= 32) {
    // STABLE derivation (no random tail) so encrypted secrets survive restarts in dev.
    return createHash('sha256').update(`${jwtSecret}|mfa-enc|`).digest();
  }
  throw new Error('FATAL: cannot derive an MFA encryption key — set MFA_ENC_KEY (or JWT_SECRET in dev).');
}

// Lazy + memoized so an unrelated import doesn't crash at load if env isn't
// ready, and so tests can set MFA_ENC_KEY before first use.
let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = getKey();
  return cachedKey;
}

/** Encrypt a UTF-8 plaintext → `iv.tag.ciphertext` (all base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

/** Decrypt an `iv.tag.ciphertext` payload produced by {@link encryptSecret}. */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted MFA secret.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
