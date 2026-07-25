# TOTP MFA for SUPER_ADMIN — Design Spec

> S6 Option B (fast-follow to the shipped Option A lockout). Adds time-based one-time
> password (TOTP) multi-factor auth for the SUPER_ADMIN role. Branch `RFID`, 2026-07-25.
> Fully offline (pure-JS libs, no network). Decisions confirmed with the user:
> **SUPER_ADMIN-only · mandatory enrolment on next login · QR + manual key · downloadable backup codes.**

## Goals / non-goals

- **Goal:** a SUPER_ADMIN cannot obtain a session with the password alone — a second factor (TOTP or a one-time backup code) is required, and enrolment is forced at next login.
- **Non-goal (this pass):** MFA for other roles, SMS/email OTP, WebAuthn/passkeys, "remember this device." (All future options; the design leaves room.)

## Dependencies (both pure-JS, offline-safe)

- Backend: **`otplib`** — TOTP secret generation + verification (30s step, ±1 window skew tolerance).
- Frontend: **`qrcode`** — render the `otpauth://` URI to a `<canvas>`/data-URI QR in-browser (no server QR dep, no external calls).

## Data model (one hand-authored migration + `db:verify-migrations` drift guard)

New nullable columns on `User`:

| Column | Type | Purpose |
|--------|------|---------|
| `mfa_enabled` | `Boolean @default(false)` | MFA active for this user |
| `mfa_secret` | `String?` | TOTP secret, **AES-256-GCM encrypted at rest** (never plaintext) |
| `mfa_enrolled_at` | `DateTime?` | when enrolment completed |
| `mfa_backup_codes` | `Json?` | array of `{ hash, usedAt }` — 10 single-use codes, SHA-256 hashed |

Enrolment state is derived: `mfa_secret` set + `mfa_enabled=false` = pending; `mfa_enabled=true` = active.

## Secret at rest — `lib/mfa-crypto.ts`

AES-256-GCM encrypt/decrypt of the TOTP secret. Key from `MFA_ENC_KEY` (installer-generated, 32-byte). Dev fallback: derive a stable key from `JWT_SECRET` with a domain-separation label (mirrors `offline-replay-token.ts`), with a `console.warn`. Ciphertext stored as `iv:tag:ciphertext` base64. **Rationale:** a DB/backup leak of plaintext TOTP secrets would fully bypass MFA — encrypting closes that (and avoids introducing the very plaintext-secret finding the audit flagged).

## TOTP core — `lib/mfa.ts`

- `generateSecret()` → base32 secret + `otpauth://totp/DigiLog:<username>?secret=...&issuer=DigiLog`.
- `verifyToken(secret, code)` → boolean (otplib `authenticator.verify`, window ±1).
- `generateBackupCodes()` → 10 codes (e.g. `xxxx-xxxx`, crypto-random) + their SHA-256 hashes.
- `verifyBackupCode(hashes, code)` → index of a matching unused code, or −1.

## Auth flow (backend — `auth.service.ts`, `auth/routes.ts`)

**Challenge token:** a short-lived (5 min) signed JWT, `typ: 'mfa-challenge' | 'mfa-enroll'`, binding `sub` (userId) + a nonce. Signed with the existing JWT secret but a distinct `typ` so it can never be used as a session token. It carries no permissions.

1. `POST /api/auth/login` — verify password (unchanged, incl. lockout). Then branch on the user:
   - **SUPER_ADMIN + `mfa_enabled`** → return `{ mfaRequired: true, mfaToken }` (challenge). No session issued.
   - **SUPER_ADMIN + not enrolled** → return `{ mfaEnrollmentRequired: true, mfaToken }` (enroll).
   - **Everyone else** → issue the session JWT exactly as today. **Zero behaviour change for non-SA.**
2. `POST /api/auth/mfa/verify` `{ mfaToken, code }` — validate the `mfa-challenge` token, then TOTP **or** an unused backup code (mark it used). On success, run the normal post-auth path (session create, single-tab, audit `LOGIN`, `MFA_VERIFIED`) and return the session JWT + user.
3. `POST /api/auth/mfa/enroll/start` `{ mfaToken }` — validate `mfa-enroll` token; generate + store encrypted **pending** secret; return `{ otpauthUri, secret }` for the QR.
4. `POST /api/auth/mfa/enroll/verify` `{ mfaToken, code }` — validate token + a TOTP code against the pending secret; set `mfa_enabled=true`, `mfa_enrolled_at`, generate + persist hashed backup codes; audit `MFA_ENROLLED`; return `{ backupCodes[] }` (shown once) **and** the session JWT.

Rate limits: `/mfa/verify` and `/mfa/enroll/verify` get the same 10/min-per-IP as login. Failed TOTP does **not** trip account lockout (a valid session isn't at stake; the challenge token expires in 5 min), but repeated failures are audited (`MFA_FAILED`).

## Recovery (lost device) — `scripts/reset-superadmin-mfa.ts`

Host-only (needs server `DATABASE_URL`; not an HTTP route). Clears `mfa_secret`/`mfa_enabled`/`mfa_backup_codes` so the SA re-enrols at next login. Writes an `MFA_RESET` audit row. Sibling to `reset-superadmin-lockout.ts`. Break-glass safety net — same philosophy as Option A.

## Frontend (`apps/web`)

- **Login page** (`routes/auth/login.tsx` + `hooks/use-auth.ts`): after password submit, branch on the response — `mfaRequired` → render a 6-digit code step (with "use a backup code" toggle) calling `/mfa/verify`; `mfaEnrollmentRequired` → route into the enrolment wizard.
- **Enrolment wizard** (`routes/auth/mfa-enroll.tsx`): step 1 shows the QR (rendered from `otpauthUri` via `qrcode`) + the manual base32 key; step 2 confirms a code (`/mfa/enroll/verify`); step 3 shows the 10 backup codes with **copy + download .txt**, then continues to the app.
- SA **cannot** self-disable MFA in the UI (it's mandatory); a "regenerate backup codes" action (reauth-gated) is a nice-to-have, deferred.

## Audit actions (add to `packages/shared`)

`MFA_ENROLLED`, `MFA_VERIFIED`, `MFA_FAILED`, `MFA_RESET`. Keep unemitted-safe per the 21 CFR retention convention.

## Permissions / reauth

No new permission (MFA is identity, not a capability). No reauth-action change. SUPER_ADMIN bypass logic elsewhere is untouched.

## Testing

- `lib/mfa` unit: TOTP valid / invalid / clock-window ±1; backup-code single-use + wrong code; secret round-trips through `mfa-crypto`.
- `auth.service` unit: SA-enabled → `mfaRequired`; SA-unenrolled → `mfaEnrollmentRequired`; non-SA → normal token (regression); `/mfa/verify` success issues a session; expired/`wrong-typ` challenge token rejected.
- Existing auth/reauth/user/plugin suites stay green.

## Offline / deployment

`otplib` + `qrcode` are pure JS → work air-gapped. TOTP is clock-based (no network). Installer generates `MFA_ENC_KEY`. **Caveat to document:** TOTP requires the server clock and the authenticator device clock to be roughly in sync (±30s); on an isolated LAN with no NTP, large drift breaks codes — backup codes + the recovery CLI mitigate.

## Rollout / risk

- Non-SA users are completely unaffected (flow branches only for SUPER_ADMIN).
- The mandatory-enrolment gate + the host-only recovery CLI together prevent a permanent SA lockout.
- Migration is additive (nullable columns) — safe on populated DBs.
