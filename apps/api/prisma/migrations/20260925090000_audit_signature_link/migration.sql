-- 2026-09-25 -- audit compliance F2 (strict audit 2026-09-24): link a signed
-- audit row to its electronic signature. signature_audit_id carries the id of
-- the REAUTH_SUCCESS row written by the re-auth gate for the same request.
-- NULL for every existing row and for unsigned actions. Purely additive.
ALTER TABLE "audit_trail" ADD COLUMN "signature_audit_id" UUID;
CREATE INDEX "audit_trail_signature_audit_id_idx" ON "audit_trail"("signature_audit_id");
