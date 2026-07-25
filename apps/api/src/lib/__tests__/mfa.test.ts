import { describe, it, expect, beforeAll } from 'vitest';
import { authenticator } from 'otplib';
import {
  generateMfaSecret,
  verifyTotp,
  generateBackupCodes,
  findUnusedBackupCode,
} from '../mfa.js';

describe('mfa TOTP core', () => {
  it('generates a secret + otpauth URI carrying issuer and username', () => {
    const { secret, otpauthUri } = generateMfaSecret('superadmin');
    expect(secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(otpauthUri).toContain('otpauth://totp/');
    expect(otpauthUri).toContain('DigiLog');
    expect(otpauthUri).toContain('superadmin');
    expect(otpauthUri).toContain(`secret=${secret}`);
  });

  it('verifies a current TOTP token and rejects a wrong one', () => {
    const { secret } = generateMfaSecret('sa');
    const current = authenticator.generate(secret);
    expect(verifyTotp(secret, current)).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('rejects malformed tokens without throwing', () => {
    const { secret } = generateMfaSecret('sa');
    expect(verifyTotp(secret, 'abc')).toBe(false);
    expect(verifyTotp(secret, '12345')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
  });
});

describe('mfa backup codes', () => {
  it('generates 10 formatted codes with matching hashes', () => {
    const { plaintext, stored } = generateBackupCodes();
    expect(plaintext).toHaveLength(10);
    expect(stored).toHaveLength(10);
    for (const code of plaintext) expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(stored.every((c) => c.usedAt === null)).toBe(true);
  });

  it('matches an unused code and returns its index', () => {
    const { plaintext, stored } = generateBackupCodes();
    const idx = findUnusedBackupCode(stored, plaintext[3]);
    expect(idx).toBe(3);
  });

  it('is case-insensitive and format-strict', () => {
    const { plaintext, stored } = generateBackupCodes();
    expect(findUnusedBackupCode(stored, plaintext[0].toUpperCase())).toBe(0);
    expect(findUnusedBackupCode(stored, 'nope')).toBe(-1);
    expect(findUnusedBackupCode(stored, '1234-5678-9012')).toBe(-1);
  });

  it('skips a code already marked used (single-use)', () => {
    const { plaintext, stored } = generateBackupCodes();
    stored[2].usedAt = new Date().toISOString();
    expect(findUnusedBackupCode(stored, plaintext[2])).toBe(-1);
    // a different, unused code still matches
    expect(findUnusedBackupCode(stored, plaintext[5])).toBe(5);
  });

  it('returns -1 when no codes match', () => {
    const { stored } = generateBackupCodes();
    expect(findUnusedBackupCode(stored, 'dead-beef')).toBe(-1);
  });
});

describe('mfa-crypto (AES-256-GCM at rest)', () => {
  let encryptSecret: (s: string) => string;
  let decryptSecret: (s: string) => string;

  beforeAll(async () => {
    process.env.MFA_ENC_KEY = 'unit-test-mfa-encryption-key-0123456789abcdef';
    const mod = await import('../mfa-crypto.js');
    encryptSecret = mod.encryptSecret;
    decryptSecret = mod.decryptSecret;
  });

  it('round-trips a secret through encrypt/decrypt', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret); // not plaintext
    expect(enc.split('.')).toHaveLength(3); // iv.tag.ct
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('SAMESECRET234567');
    const b = encryptSecret('SAMESECRET234567');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('SAMESECRET234567');
    expect(decryptSecret(b)).toBe('SAMESECRET234567');
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    const [iv, tag, ct] = enc.split('.');
    const tampered = `${iv}.${tag}.${Buffer.from('evil').toString('base64')}${ct.slice(6)}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws on a malformed payload', () => {
    expect(() => decryptSecret('not-valid')).toThrow(/Malformed/);
  });
});
