# DigiLog — Comprehensive Security, Quality, Performance & Compliance Audit

> Branch `RFID`, 2026-07-25. Conducted across the full stack (Fastify API, React SPA,
> Android APK, PostgreSQL/Prisma, dependencies, deployment) by six parallel evidence-based
> reviews (auth/authz, injection/input, crypto/secrets, API+frontend, DB+deps+quality,
> dependency-CVE) plus the standing Android audit (`docs/ANDROID-OFFLINE-READINESS.md`).
> Every finding carries `file:line` evidence. No assumptions.

---

## 1. Executive Summary

**DigiLog has a strong, mature security posture. There are ZERO Critical and ZERO High
runtime findings.** The codebase shows deliberate, threat-model-aware engineering:
per-route auth rate limits with timing-equalized login, bcrypt cost 12, HS256-pinned JWT
that fails closed in production, secret masking before immutable audit writes, a keyed-HMAC
tamper-evident audit chain, capped pagination, magic-byte upload validation, subset-checked
privilege-escalation guards, and a safely-handled backup/restore path (no zip-slip + a
zip-bomb guard). No swallowed exceptions, no injectable raw SQL, no XSS sinks.

The audit surfaced **~6 Medium** and **~12 Low/Info** items. None is architectural; all are
small, targeted fixes. The items that matter most for a **21 CFR Part 11** install are two
*configuration/compliance* gaps (audit hash-chain shipping unkeyed by default; reauth able to
silently self-disable on a malformed config) and two *classic web* fixes (spreadsheet formula
injection in exports; an unvalidated `returnUrl` open-redirect).

**Dependency scan:** `npm audit` reports 20 vulns (1 critical, 17 high, 2 moderate) — but
**every high/critical is transitive and either build-time-only (`tar` via bcrypt's install
step) or SSR-only (`react-router`, not applicable to this SPA).** Real runtime exploitability
is Low; they should still be cleared to satisfy inspectors.

**Verdict (see §15): CONDITIONALLY production-ready for a regulated pharma environment** —
no blockers of Critical/High severity, but the ~6 Medium items (especially the two compliance
ones) should be closed before go-live. Estimated remediation: **2–4 developer-days.**

### Resolution log — 2026-07-25 (same-day remediation)

| Item | Status | What changed |
|------|--------|--------------|
| **S3** formula injection | ✅ **Fixed** | `lib/spreadsheet-safe.ts` (`neutralizeRow`) prefixes `= + - @ TAB CR` cells; applied to `replacement-schedule/export.ts` + `pm-schedules/pm-export.ts`. Unit-verified. |
| **S4** open redirect | ✅ **Fixed** | `login.tsx` validates `returnUrl` (internal path only), mirroring `use-auth.ts:137`. |
| **S5** mass assignment | ✅ **Fixed** | `PUT /templates/:id`: `additionalProperties:false` + explicit field whitelist (no `req.body as any`). |
| **S1** audit chain unkeyed | ✅ **Fixed (installer)** | `install.ps1` generates a per-install `AUDIT_CHAIN_KEY` (48B CSPRNG) → fresh installs run keyed HMAC-SHA256 v3 by default. |
| **S2** reauth silent-disable | ✅ **Surfaced** | Was already `console.warn`-loud; now also a `reauth-policy` sub-check on the SUPER_ADMIN deployment-check (`getReauthHealth()` → FAIL on legacy shape / WARN when 0 actions gated). |
| **S6** SA lockout/expiry exemption | ✅ **Fixed (Options A + B)** | (A) SUPER_ADMIN participates in lockout; (B) SUPER_ADMIN requires **TOTP MFA** (enforced by default; QR enrolment + backup codes; AES-256-GCM secret at rest). Both have host-only recovery CLIs (`reset-superadmin-lockout.ts`, `reset-superadmin-mfa.ts`). MFA backend verified end-to-end (`e2e/mfa-flow.test.ts`); 12 lib + 4 gate unit tests. See `docs/superpowers/specs/2026-07-25-super-admin-mfa-design.md`. |
| **Deps** (`tar` critical etc.) | ⚠️ **Deferred, justified** | `npm audit fix` is blocked by an ERESOLVE peer conflict; the critical `tar` is pinned to 6.x by `bcrypt → node-pre-gyp` and is **install/build-time only** (not runtime-reachable). Forcing it risks breaking bcrypt/login for zero runtime gain. Real fix = migrate `bcrypt → bcryptjs` (drops node-pre-gyp/tar **and** the Windows native-binary risk) in a tested PR. |

**Net after this pass:** 5 of 6 Mediums fixed in code (S1, S3, S4, S5, S6), 1 surfaced operationally (S2). The remaining go-live actions are optional hardening: TOTP MFA for SUPER_ADMIN (S6 Option B, fast-follow) and the bcrypt→bcryptjs dependency migration to clear the transitive-CVE headline.

---

## 2. Architecture Review

Full diagrams in `docs/OFFLINE-DEPLOYMENT-READINESS.md` §2 (server/web) and
`docs/ANDROID-OFFLINE-READINESS.md` §2 (APK). In brief:

- **Frontend:** React 19 SPA (Vite 6), SWR, Tailwind 4, React Router 7. Served statically by the API.
- **Backend:** Fastify 5 (TypeScript), 33 modules, ~200 endpoints, Prisma 6 → PostgreSQL 18.
- **AuthN/Z:** local JWT (`jose`, HS256) + bcrypt; RBAC (102 perms / 83 privileges / 92 reauth actions) via `PERMISSION_TREE`. Optional LDAP.
- **Jobs:** graphile-worker (Postgres-backed): notification, pm-overdue, password-expiry, session-sweep.
- **Android:** Capacitor 8 shell loading the bundled SPA; USB RFID via `Reader_Usb.jar`. No Firebase/GMS/analytics.
- **Compliance:** immutable, hash-chained `audit_trail` (SHA-256 / keyed HMAC-SHA256), electronic-signature reauth, single-tenant/single-site.

---

## 3. Security Findings (consolidated, most-severe first)

| # | Severity | Title | File:Line | Domain |
|---|----------|-------|-----------|--------|
| S1 | **Medium** | Audit hash chain ships **unkeyed** by default (`AUDIT_CHAIN_KEY` unset → forgeable by a DB actor) | `apps/api/.env:24`, `lib/hash-chain.ts:35-41,101-109` | Crypto / §11 |
| S2 | **Medium** | Reauth (e-signature gate) **silently disables itself** on a legacy `action-reauth` config shape | `lib/reauth-check.ts:89-102` | AuthZ / §11 |
| S3 | **Medium** | CSV/Excel **formula injection** in XLSX exports (no `= + - @` neutralization) | `modules/replacement-schedule/export.ts:47-69`, `pm-schedules/pm-export.ts:60-79` | Injection |
| S4 | **Medium** | **Open redirect** — `returnUrl` used unvalidated (guard exists in sibling path) | `apps/web/src/routes/auth/login.tsx:57-58` | Frontend |
| S5 | **Medium** | **Mass assignment** — `PUT /templates/:id` does `data: req.body as any`, no `additionalProperties:false` | `modules/notification-delivery/routes.ts:642-647` | Injection |
| S6 | **Medium** | SUPER_ADMIN is **lockout-exempt + password-expiry-exempt**, and default cred is `Admin@123` | `auth.service.ts:34,113-115,214-218` | Auth |
| S7 | Low | 30s auth-cache **zombie window** on role-change session revocation (runs with *new* perms) | `plugins/auth.ts:100-102`, `user.service.ts:216` | Auth |
| S8 | Low | `GET /users/:id` leaks SUPER_ADMIN detail to lower roles (no hierarchy filter on by-id) | `user.service.ts:71-75` | AuthZ / IDOR |
| S9 | Low | Profile-photo downloads are **unauthenticated** (URL-secrecy only) | `plugins/auth.ts:194` | AuthZ |
| S10 | Low | LDAP/SMTP TLS cert-validation is **admin-disableable** (`rejectUnauthorized` toggle) | `ldap.service.ts:143,162,226`, `email-channel.ts:202,227` | Crypto |
| S11 | Low | CSP allows `script-src 'unsafe-inline'` (for Swagger) across the whole API-served surface | `apps/api/src/app.ts:133` | Frontend |
| S12 | Low | User-list returns **all users** when `limit` omitted (no max cap) | `user.repository.ts:36`, `users/routes.ts:201` | API / DoS |
| S13 | Low | Offline-replay tokens persisted to **localStorage** (XSS-exfiltratable) | `use-auth.ts:106-107`, `mobile-login.tsx:87-88` | Frontend |
| S14 | Low | Credentials (LDAP bind / SMTP / SMS) stored **plaintext at rest** in `system_config` | `modules/ldap/`, `modules/notification-delivery/` | Crypto |
| S15 | Low | Some hierarchy FKs lack explicit `onDelete` (Prisma default `SetNull` → orphan pointers) | `schema.prisma:493,519-520,553` | DB |
| S16 | Info | Global HTML sanitization is **opt-in per module**, not a global hook | `lib/sanitize.ts` | Injection |
| S17 | Info | No object-level scoping on filter-op `:id` writes (not IDOR — single-tenant, no ownership dim) | `filter-resolver.ts:27` | AuthZ (design) |
| S18 | Info | JWT carries no `iss`/`aud` claims | `lib/jwt.ts` | Auth |
| S19 | Info | No document-level CSP `<meta>` for the APK/dev WebView | `apps/web/index.html` | Frontend |

### Verified SAFE (done well — not findings, recorded for the auditor)
- **SQL injection: none.** All `$queryRaw`/`$executeRaw` sites are parameterized tagged templates; `$queryRawUnsafe` identifier interpolation is guarded by `assertSafeIdentifier()` + catalog-sourced names; audit `ALTER TABLE … DISABLE TRIGGER` uses hardcoded/`pg_trigger`-sourced names (`audit/routes.ts:697-702`).
- **LDAP injection: none** — RFC 4515 escaping applied before filter substitution (`ldap.service.ts:22-29,174`).
- **Command injection: none** — only `exec` is hardcoded `wmic`/`df` in system-health.
- **Path traversal / upload: none** — UUID filenames, MIME allowlist + magic-byte check, size cap (`uploads/routes.ts:89-136`).
- **Zip-slip: none** — restore reads entries in-memory, never extracts to disk, and adds a zip-bomb guard (`backup.service.ts:274-315`).
- **JWT:** HS256 pinned (no `alg:none`), fails closed in prod, TTL-clamped, domain-separated secrets.
- **Login:** timing-equalized (`DUMMY_HASH`), unified `INVALID_CREDENTIALS`, lockout after 5, reauth/change-password funnel through the same lockout.
- **Privilege escalation:** subset-checked role edits (`assertRoleWithinCallerPrivilege`), `assertCanManageTarget` on user ops, SA-delete protection.
- **Secrets:** none committed; installer generates per-install CSPRNG secrets; secret masking before audit writes; no `NODE_TLS_REJECT_UNAUTHORIZED`/`rejectUnauthorized:false` in source.
- **Headers:** CSP + HSTS + frame-ancestors 'none' + nosniff; CORS locked to allowlist (throws in prod if unset); `trustProxy` false (no XFF spoof).
- **Error handling:** generic 500 in prod, no stack-trace leakage. **No swallowed exceptions** anywhere in `apps/`.

---

## 4. Vulnerability / Dependency Report

`npm audit --omit=dev`: **20 (1 critical, 17 high, 2 moderate)** — all transitive. Traced:

| Package | Ver | npm Severity | Chain | **Real runtime risk** | Fix |
|---------|-----|--------------|-------|----------------------|-----|
| `tar` | 6.2.1 | **Critical** (path-traversal/zip-slip/DoS family) | `bcrypt → @mapbox/node-pre-gyp → tar` | **Low — install/build-time only**; not in the running server's code path | `npm audit fix` |
| `react-router`/`-dom` | 7.18.1 | High | `apps/web` | **Low — advisories target SSR/framework mode; DigiLog is a pure client SPA** | bump to patched |
| `uuid` | <11.1.1 | Moderate | via `exceljs` | **Low** — bounds check only when caller passes `buf`; not user-reachable | `npm audit fix --force` (breaks exceljs — evaluate) |

Direct deps are modern and low-risk: Fastify 5.10, Prisma 6.3, React 19, jose 6, bcrypt 5.1, nodemailer 9, ldapts 8, exceljs 4.4, adm-zip 0.5.16 (used safely), sanitize-html 2.17, zod 3.24, graphile-worker 0.16.6, Capacitor 8. Minor: `@types/nodemailer ^7` vs `nodemailer ^9` skew; `bcrypt` is the last native-binding dep (prebuilt-binary miss on a Windows install would break login — ensure binaries ship, or move to `bcryptjs`).

**Action:** run `npm audit fix` (non-breaking) in CI to clear the transitive high/criticals — primarily to remove the "critical" headline an inspector will flag, since real exploitability is Low.

---

## 5. Bug / Functional Report

No functional/correctness defects surfaced in the security sweep (this was not a full manual
UI pass — see `manual-tester` skill for that). Quality debt affecting correctness-risk:
frontend **God-components** (§10) concentrate complex state and are merge-conflict/regression-prone.
Recommend a targeted manual + Playwright pass on the mobile operations flow given its 4590-line size.

---

## 6. Performance Report

**Strong.** Thorough indexing (§7), batched audit read-side enrichment (**not N+1**, `audit/routes.ts:194-316`),
`Promise.all` for independent reads, no blocking sync I/O in request paths (only TLS-cert `readFileSync`
at boot). Minor: bulk filter upload writes **per-row in a loop** (`bulk-upload-filter.service.ts:197-210`) —
a deliberate partial-success/validation trade-off, fine for 50–100 rows, poor for very large imports
(fix: `createMany` survivors if large imports become common). User-list unbounded (S12) is a mild DoS/perf risk.

---

## 7. Database Report

**A strength.** `audit_trail` carries 7 indexes matching its query/sort columns (`schema.prisma:308-314`);
`cleaning_cycles`, `filter_events`, `user_sessions`, `notifications` all well-indexed. FKs enforced with
deliberate `onDelete` (e.g. `AssetInstance.parent` → `Restrict` to stop hierarchy orphaning). Real
immutability triggers: `audit_trail_no_delete` (BEFORE DELETE → `RAISE EXCEPTION`), `chain_position`
`BIGSERIAL` sequence, consistency triggers. Hash chain is keyed-HMAC-capable with a cutover anchor
(`AUDIT_CHAIN_KEYED_FROM`) and a 2026-07-15 fix that closed a redacted-row verify hole. Gaps: S15 (a
few hierarchy FKs lack explicit `onDelete`); by design, physical audit deletion permanently invalidates
downstream `verify-chain` (~3408 historical anomalies already exist) — REDACT is the recommended,
chain-preserving path.

---

## 8. API Report — Security Score: **86 / 100**

Every admin/data-mutating endpoint carries an RBAC preHandler (verified: no unguarded high-priv mutation).
AuthN, AuthZ, zod validation, error handling, audit logging, and pagination caps are consistently applied.
Deductions: mass-assignment on one template route (S5), unbounded user-list (S12), a couple of auth-only
mutations reachable by any role (`POST /audit/report-export-log`, `POST /uploads/photo` — documented,
low-blast), and no `iss`/`aud` on the JWT (S18). No versioning scheme (single-service, low concern).

---

## 9. Android Report

Full audit in `docs/ANDROID-OFFLINE-READINESS.md`. Summary: Capacitor 8 shell, bundled SPA (no `server.url`,
no CDN), USB RFID via local jar, **no Firebase/GMS/analytics/push, 0 native `.so`, no third-party network SDK**.
Manifest declares only `INTERNET` (for LAN); one **non-exported** runtime USB-permission receiver; `FileProvider`
not exported; **no certificate pinning and no CRL/OCSP dependency**; trusts system+user+bundled root CA (supports
self-signed LAN certs). No secrets/hardcoded creds in the APK. Note: `usesCleartextTraffic=true` (dev fallback;
prod uses HTTPS) and no root-detection (acceptable for a controlled appliance). No Critical/High.

---

## 10. Code Quality Report — Score: **78 / 100**

Disciplined: **zero swallowed exceptions** across `apps/` (CLAUDE.md rule genuinely respected), batched queries,
parallelized reads, no sync I/O in hot paths. **Main debt — God-components (Medium):** `mobile-operations.tsx`
**4590 lines**, `mobile-wrapper.tsx` 3350, `filter-list.tsx` 2108, `filter-operations.tsx` 1965. Large backend
service files (`filter-operations.service.ts` 1013, `audit/routes.ts` 836) are approaching but not past the
threshold and are already being split. Fix: extract per-stage/dialog subcomponents + shared hooks.

---

## 11. Dependency Report

See §4. Modern stack, one build-time transitive critical (`tar`), otherwise clean. Recommend `npm audit fix`
in CI + a `bcrypt` prebuilt-binary check in the installer.

---

## 12. Compliance Report (21 CFR Part 11 / GAMP 5) — Score: **83 / 100**

**Present & strong:** immutable hash-chained audit trail with keyed-HMAC option; electronic-signature reauth on
sensitive ops (92 reauth actions); RBAC; password policy + expiry; forced first-login password change; secret
masking so credentials never land in the audit trail; backup/restore. **Compliance-affecting gaps to close before
attestation:** S1 (ship the audit chain **keyed** — unkeyed is forgeable by a DB actor), S2 (reauth can silently
void itself on a bad config — must fail loud), S6 (SA lockout/expiry exemption + default cred). These are
configuration/hardening items, not missing controls.

---

## 13. Risk Matrix

| Severity | Count | Items |
|----------|-------|-------|
| **Critical** | **0** | — |
| **High (runtime)** | **0** | (npm-rated high/critical deps are build-time/SSR-only → Low runtime) |
| **Medium** | 6 | S1 hash-chain-unkeyed, S2 reauth-silent-disable, S3 formula-injection, S4 open-redirect, S5 mass-assignment, S6 SA-lockout/default-cred |
| **Low** | 11 | S7–S15, plus bulk-upload-N+1, bcrypt-native-binary |
| **Info** | 6 | S16–S19, @types skew, physical-delete-breaks-chain |

---

## 14. Prioritized Remediation Plan

**Before go-live (compliance + classic-web Mediums) — ~2–4 dev-days:**
1. **S1** — Set `AUDIT_CHAIN_KEY` (48B CSPRNG, backed up off-DB) at install; record `AUDIT_CHAIN_KEYED_FROM`; treat unkeyed as non-compliant. *(installer + runbook; ~0.5d)*
2. **S2** — Make `normalizeActionReauthConfig` fail loud (health-endpoint + UI surface) instead of returning `{}` (reauth off). *(~0.5d)*
3. **S3** — Neutralize `= + - @ \t \r`-leading cell values in `export.ts`/`pm-export.ts` before `addRow`. *(~0.5d)*
4. **S4** — Apply the existing `isSafeReturnUrl` guard (`use-auth.ts:137`) in `login.tsx:57-58`. *(~0.25d)*
5. **S5** — Add `additionalProperties:false` to the notification-template PUT schema. *(~0.25d)*
6. **S6** — Apply lockout to SUPER_ADMIN (or require proven strong SA password + consider MFA). *(~0.5d)*
7. **Deps** — `npm audit fix` in CI to clear the transitive critical/high headline. *(~0.25d)*

**Soon after (Lows):** S7 (evict session IDs on role-change), S8 (hierarchy filter on `getById`), S11 (scope `unsafe-inline` to `/docs`), S12 (cap user-list), S9/S13 (auth-gate uploads / minimize replay-token TTL), S15 (explicit `onDelete`).

**Backlog (quality):** decompose `mobile-operations.tsx` and the other God-components; consider `bcryptjs`; add `iss`/`aud` claims; envelope-encrypt secret config; global sanitize hook; document-level CSP for the APK.

**No MFA today** — for a regulated multi-user pharma system, evaluate adding MFA (at minimum for SUPER_ADMIN) as a roadmap item; it is a common inspector expectation though not strictly mandated by §11.

---

## 15. Final Deployment Readiness Assessment — Score: **80 / 100**

### Final question: *Is this application production-ready for a regulated pharmaceutical environment?*

> ## ⚠️ CONDITIONALLY YES — no Critical/High blockers, but close the 6 Medium items first.
>
> DigiLog is **architecturally sound and securely engineered** — strong authN/Z, tamper-evident
> audit trail, disciplined code, safe data layer, no injectable SQL, no XSS sinks, no committed
> secrets, and a clean offline/LAN deployment story on both server and Android. There is **no
> Critical or High-severity runtime vulnerability**, and the dependency CVEs that npm rates
> critical/high are build-time- or SSR-only and not runtime-exploitable in this deployment.
>
> It is **not yet unconditionally ready** for a 21 CFR Part 11 pharma go-live because of **six
> Medium items**, two of which are compliance-affecting configuration gaps that can silently
> undermine §11 attestation:
> - **S1** audit hash chain must ship **keyed** (unkeyed = forgeable by a DB actor).
> - **S2** reauth/e-signature must **fail loud**, never silently self-disable.
> - **S3** spreadsheet **formula injection** in exports (targets the auditor's workstation).
> - **S4** **open redirect** on login `returnUrl`.
> - **S5** **mass assignment** on the notification-template PUT.
> - **S6** SUPER_ADMIN **lockout/expiry exemption** + default credential.
>
> **These are small, targeted fixes (~2–4 developer-days total), not architecture changes.**
> After they land (and `npm audit fix` clears the transitive CVE headline), the application is
> production-ready for a controlled, LAN-isolated pharmaceutical deployment. MFA (at least for
> SUPER_ADMIN) is recommended as a fast-follow roadmap item.

### Scorecard
| Dimension | Score | Basis |
|-----------|-------|-------|
| Security | **82** | 0 Critical/High; 6 Medium; strong fundamentals |
| API Security | **86** | Consistent RBAC + validation + caps; minor mass-assignment/exposure |
| Code Quality | **78** | Disciplined; God-components drag it |
| Performance | **85** | Indexed, batched, no hot-path sync I/O |
| Maintainability | **72** | 4590-line components are the main debt |
| Deployment Readiness | **80** | Solid; clear the CVE headline + key the audit chain |
| Compliance (21 CFR §11) | **83** | Controls present; 3 config/hardening gaps to close |

*Scores are the auditor's weighted judgement: baseline 100, minus weighted deductions
(Critical −25, High −12, Medium −4, Low −1.5, Info −0.3 within each dimension's scope),
floored by the strength of verified-safe controls.*
