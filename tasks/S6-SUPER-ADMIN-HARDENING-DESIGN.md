# S6 — SUPER_ADMIN account hardening (design decision)

> Finding S6 (Medium) from `docs/SECURITY-AUDIT-2026-07-25.md`. **Not yet implemented**
> — it requires a product decision because a naïve fix can permanently lock the only
> recovery account. This note lays out the problem, options, and a recommendation.

## The finding

The `superadmin` account is uniquely privileged AND uniquely unprotected:

- **Lockout-exempt** — `auth.service.ts:34` skips the failed-attempt lockout for SUPER_ADMIN; `:113-115,177-186` auto-unlock / never lock it.
- **Password-expiry-exempt** — `auth.service.ts:214-218` + `plugins/auth.ts:310` skip expiry for SUPER_ADMIN.
- **Ships with a known default** — `superadmin` / `Admin@123` (forced-change on first login, which mitigates the *initial* exposure).

**Why it's exempt (the real constraint):** SUPER_ADMIN is the break-glass account. If it could lock and there were no recovery path, a brute-force attempt (or a fat-fingered operator) could permanently lock the *only* account able to manage users/roles — with no way back in short of direct DB surgery. The exemption is a deliberate availability trade-off, not an oversight.

**Residual risk:** the one all-powerful account is the one account whose password never rotates and that can never lock, defended online only by the 10/min-per-IP login rate limit (~14.4k/day, distributable across IPs).

## Options

### Option A — Lockout for SUPER_ADMIN + a host-only recovery CLI (recommended)
Apply the same failed-attempt lockout to SUPER_ADMIN, and ship a recovery script that only someone with **local shell access to the server** can run:
```
npx tsx apps/api/scripts/reset-superadmin-lockout.ts   # clears lockout + failedLoginAttempts
```
- Closes the online brute-force gap (attacker without host access can't grind indefinitely).
- Preserves break-glass: the on-site engineer clears the lock locally.
- Effort: ~0.5–1 day (lockout branch + script + doc). Low blast radius; the script is the safety net.
- **This is the standard pattern** for regulated single-admin systems.

### Option B — MFA for SUPER_ADMIN (strongest; larger scope)
Require TOTP (e.g. `otplib`) for the SUPER_ADMIN login (optionally all admins). Recovery via backup codes generated at enrolment.
- Best defense; also the most common inspector expectation for §11 privileged access.
- Effort: ~2–4 days (enrolment UI, verify step, backup codes, recovery, tests). Offline-friendly (TOTP needs no Internet).
- Recommended as a **fast-follow roadmap item** even if Option A ships first.

### Option C — Enforce a provably-strong SA password + periodic rotation, keep exemption
Require the first-login SA password to meet a high bar (length + complexity, not on a breach list) and force rotation on the SA too.
- Cheapest (~0.5 day), but leaves the "never locks" gap. Weakest of the three.

## Recommendation

**Ship Option A now** (lockout + host-only recovery CLI) — it removes the exploitable online-brute-force gap while preserving break-glass recovery — and **schedule Option B (TOTP MFA for SUPER_ADMIN)** as the compliance-grade follow-up. Option C alone is insufficient for a regulated environment.

## Why not auto-fixed in this pass

Blindly enabling lockout on SUPER_ADMIN without the recovery CLI would trade a Medium security gap for a **High availability risk** (permanent lock-out of the only admin). Per the audit discipline, that is a worse outcome; it needs the paired recovery mechanism, which is a deliberate build + test, not a one-line change.
