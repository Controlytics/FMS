-- TOTP MFA for SUPER_ADMIN (S6 Option B). Additive, nullable columns — safe on
-- populated DBs. mfa_secret holds the AES-256-GCM ciphertext (lib/mfa-crypto.ts),
-- never a plaintext TOTP secret. mfa_backup_codes is a JSONB array of
-- { hash, usedAt } single-use recovery codes.
ALTER TABLE "users" ADD COLUMN "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "mfa_secret" TEXT;
ALTER TABLE "users" ADD COLUMN "mfa_enrolled_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "mfa_backup_codes" JSONB;
