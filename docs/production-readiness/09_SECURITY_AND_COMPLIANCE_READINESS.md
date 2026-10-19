# 09 — Security and Compliance Readiness (what was verified under load)

This is **not** a penetration test and **not** a claim of 21 CFR Part 11 compliance. It records which
controls were exercised by the load tests on 2026-10-17, what the code and the clone's configuration
say (`grep` / `psql` on that date), and what remains for the client's own validation. Formal compliance
assessment, IQ/OQ/PQ and the audit-trail review procedure are the client's responsibility.

## 1. Controls exercised by the tests

| Control | Evidence | Result |
|---|---|---|
| Audit trail hash chain (keyed HMAC-SHA256 V3 from position 18,233; `AUDIT_CHAIN_KEY` set) | `tests/performance/data-generation/verify-perf-chain.ts` over 7,399,215 generated rows + every row written by the load runs (101 + 1,776 + 63) | **intact, 0 anomalies** after 50 concurrent users writing cycles at ~10 writes/s |
| Verifier correctness | fix 1: the verifier never read `signature_audit_id`, so **every e-signed row was reported tampered** (1,019,018 rows) | fixed; regression test; the app's `GET /api/audit/verify-chain` now agrees with the independent verifier |
| Global audit lock serialising audited writes | fix 2 removed a 1.4 s full-table scan that ran **inside** the lock on every write | no lock waits observed at 50 writers; bulk-operate bursts still to run |
| Immutability (`audit_trail` no-DELETE trigger) | the generator and the runs only ever insert; nothing deleted | not challenged by the tests (by design) |
| Concurrent decisions on one record | 30 shift officers approving the same queue rows | `400 INVALID_STATUS` / `409 CONCURRENT_DECISION` for the losers, one APPROVED row per decision (233/233) |
| Stale-screen guard (`tapeVersion`) | 96 × `409 STALE_TAPE` when an approval changed a cycle between an operator's read and write | correct: the write was refused, the client re-read |
| Single session per user (`SESSION_CONFLICT`, `force`) | the runner's `force:true` logins (synthetic users) | works; a forced login ends the other session |
| Login rate limit 100/min (`auth/routes.ts:28`) | the runner paces logins at 75/min specifically to stay under it | not triggered; it is the only brake on password guessing of SUPER_ADMIN (exempt from lockout) |
| bcrypt cost 12 for passwords | `security/bcrypt-throughput.mjs`: 228 ms per check; 40 concurrent logins → 17/s at the default threadpool of 4, 29/s at 8 | a shift-change login storm of 100 users takes ~6 s of pure hashing; `UV_THREADPOOL_SIZE=8` recommended (11) |
| Re-authentication (e-signature) on cycle writes | **not exercised**: in the clone (copied from the dev DB) `action-reauth` lists no roles for `START_CLEANING_CYCLE` etc., so the write runs carried `_currentPassword` but nothing checked it | the client's configuration decides; if enabled, add ~230 ms CPU per signed write to 04 §6 |

## 2. Configuration as found in the clone (= the dev database on 2026-10-17)

| Setting | Value | Note |
|---|---|---|
| Password policy | min 8 chars, upper/lower/number/special required, cannot contain user id, reuse of last 3 blocked, expiry 360 days, **lockout after 3 failed attempts**, idle timeout 10 min, auto-logout on | `system_config['password-policy']` |
| Session | duration capped by `JWT_EXPIRY_HOURS` (1 h default; the runner saw tokens expire after exactly 1 h) | `session.def.ts:22` |
| Transport | HTTPS only (`API_HTTPS=true`), HSTS 1 year with subdomains, CSP `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'` (`app.ts:221-246`) | `'unsafe-inline'` is added **only** when `/docs` is on |
| CORS | explicit origin allowlist from `ALLOWED_ORIGINS` (`app.ts:184`) | driven by `digilog-addresses.ini` |
| API docs | `API_DOCS=on` in the dev `.env` — serves the full API surface without login | **must be unset on the customer machine** (CLAUDE.md; F-01 / API-07) |
| Rate limits | exactly three: login 100/min, verify 50/min, change-password 50/min; no global limit | operator decision 2026-10-10 |
| Input | HTML stripped on all text fields (`lib/sanitize.ts`); request body limit 10 MB (4 KB on login); `maxProperties` caps on cycle payloads | — |
| Error leakage | every unmapped Prisma error → generic `400 DATA_CONSTRAINT` (`app.ts:404-416`), so no source paths reach clients | but capacity failures are mislabelled as client errors — 04 §2a |
| Outbound | admin-configured URLs only, through `lib/ssrf.ts` | not exercised |

## 3. Findings with a security or compliance angle

1. **Verifier false positives (fixed).** Until today an inspector running "verify audit chain" on any
   installation with e-signatures would have been told the trail was tampered. The rows were fine; the
   check was wrong. After the fix the independent verifier and the app agree on 7.4 M rows.
2. **Audit writes serialised behind a full-table scan (fixed).** Not a confidentiality issue, but an
   integrity-availability one: at one year of data every signed action waited 1.4 s under the lock and
   logins failed under load.
3. **Capacity failures look like data errors** (04 §2a), and the tablet's sync engine can mark queued
   work *permanently failed* after five such answers (`sync-engine.ts:152`). A busy server at shift
   change can therefore lose recorded operator actions on the device side. Nothing is written wrongly
   on the server; the risk is work never reaching it. Decision for the operator (11 §2).
4. **`/docs` enabled in dev** — a reminder only; the installer does not set it.
5. **No re-auth on cycle writes in this configuration.** Whether that matches the client's SOPs is a
   validation question, not a defect. If the client turns it on, the bcrypt cost becomes part of every
   signed write and the libuv threadpool size matters (11 §2).

## 4. Not done (for the client's validation team)

- Authorisation matrix / IDOR checks role by role (`tests/performance/security/` has only the bcrypt
  tool). The role→permission matrix lives in `tasks/ROLE-PRIVILEGES-DOC-ALIGNMENT.md`.
- Penetration test, dependency CVE review, TLS configuration review on the production server.
- Backup encryption / off-box storage (10).
- Audit-trail review procedure and the periodic `verify-chain` run as an SOP.
