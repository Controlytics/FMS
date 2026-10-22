# 06 — Security Assessment (Round 2)

Production-readiness campaign, deliverable 06. Assessed 2026-10-22 by agent `audit-phase1-2` with two
read-only static sub-sweeps and its own dynamic probes. **No source file was edited, nothing was
committed, `digilog_db` and `digilog_test_db` were not touched, and the API vitest suite was not run.**
This is a code-and-probe assessment, not a penetration test by an independent party, and not a claim of
21 CFR Part 11 compliance.

| Item | Value |
|---|---|
| Code assessed | `a84ee0b` (branch `RFID`). `apps/api`, `packages/shared`, `scripts` and `installer` were clean in the working tree when the assessment started (10:47 UTC). HEAD moved to `be6e0b3` while it ran, but those commits touch only web code and docs (`git diff --stat a84ee0b be6e0b3 -- apps/api packages/shared scripts installer` → empty). |
| Changes in flight (not assessed) | At 11:57 UTC other agents held **uncommitted** API edits that address findings in this report: `lib/hash-chain.ts`, `lib/audit-verify.ts`, new `lib/audit-redaction.ts`, `modules/audit/routes.ts`, `modules/backup/backup.repository.ts`, plus a new test `e2e/audit-redaction-integrity.test.ts`. Re-verify SEC-01 and SEC-02 once those are committed. |
| Dynamic target | A scratch API started from source (`npx tsx src/app.ts`, no build, no repo writes) on **port 3110** against the disposable **`digilog_qa_perf`**, with `NODE_ENV=production`, `LOG_DIR` and `UPLOAD_DIR` in the agent's scratchpad. The connection was checked before the first probe: the boot log said `Database connected (digilog_qa_perf)`, and `pg_stat_activity` showed one new connection on `digilog_qa_perf`. Run 1 used `API_DOCS=on`, only to read `/docs/json`. Run 2 used `API_DOCS=off` and served every probe. The agent stopped only its own process (checked by command line). |
| Accounts | Synthetic perf users on the clone (OPERATOR, SUPERVISOR, QA ×2, ADMIN, plus one sacrificial OPERATOR for wrong-password probes), logged in without `force`. **No SUPER_ADMIN credential was used.** Per the team lead (2026-10-22), every SA-only probe is collected in one script, `QA/tests/security/sa-session-probes.mjs`, to run in a single operator SA session at the end; those rows read **"dynamic pending SA session"** (§9). No password appears in this report. |
| Evidence legend | **EXECUTED 2026-10-22** = the agent ran it today against the scratch API or the clone; the evidence files are listed in §10. **CODE-READ 2026-10-22** = the code path was read end to end at `a84ee0b`, not run. **HYPOTHESIS** = needs the named probe. **CARRIED FORWARD &lt;date&gt;** = taken from an earlier report, with a pointer. |
| Severity | Defect-register scale: **P0** breach / corruption / outage · **P1** major · **P2** significant · **P3** minor · **INFO**. Operator decisions are listed as **ACCEPTED**, with their date and source. |

---

## 1. Summary

| Severity | Count | IDs |
|---|---|---|
| P0 | 0 | — |
| P1 | 2 | SEC-01 (OD-01, **decided 2026-10-22**: always ask for the password; fix not yet committed), SEC-02 (redacted audit rows escape tamper detection; **fix in progress**, uncommitted) |
| P2 | 5 | SEC-03 (**fixed 2026-10-22**: route removed, test-sends audited), SEC-04, SEC-05, SEC-06, SEC-07 |
| P3 | 13 | SEC-08 … SEC-20 |
| INFO | 12 | §6 |

**Results that held up:**
- The API exposes 430 operations. The static route table and the live OpenAPI document match exactly.
- 43 signed-in routes carry no permission check. Each is user-scoped, gated inside the handler, or a harmless read. None is a gap.
- No server route grants a toggle's write capability through another toggle's grant set.
- All 127 re-auth actions are enforced somewhere: 16 always ask for the password, 111 ask only when the stored policy lists the caller's role.
- `_currentPassword` is stripped on every return path, and no wrong password reached a log file or the database (EXECUTED).
- The offline-replay grant is honoured only on its 6 routes (EXECUTED).
- Security headers, CORS, the TLS 1.2 floor, Swagger fail-closed, uuid parameter checks, the date-range guard, upload content and size checks, the login rate limit and `X-Forwarded-For` non-trust all passed (EXECUTED).
- The audit chain on `digilog_qa_perf` is intact: 35,783 rows, 0 anomalies (EXECUTED).

**What does not hold up:**
- **Signatures depend on configuration.**
  - A SUPER_ADMIN is never asked for a password on any policy-driven action, because no policy row lists SUPER_ADMIN (SEC-01).
  - The filter and replacement approval decisions are unsigned for the roles that make them (SEC-07).
- **The verifier misses one kind of tampering.** It cannot detect a rewritten row once that row is marked redacted (SEC-02, proven by running the verifier's own code from `a84ee0b`).

**`npm audit --omit=dev`, root:** 11 vulnerabilities — 1 critical, 7 high, 2 moderate, 1 low. All have a fix available. Three affect the running server: `@fastify/busboy` (multipart DoS), `nodemailer` (address-parser DoS) and `sanitize-html` (a filter bypass). The critical one is the tablet's `@capacitor/android` (§7).

---

## 2. Authorization (scope 1)

### 2.1 Route inventory — EXECUTED 2026-10-22
| Measure | Value | Evidence |
|---|---|---|
| Operations in the static table at `a84ee0b` | **430**: GET 205, POST 105, PUT 87, PATCH 3, DELETE 30 | Every `app.<verb>(` parsed, the `configEndpoint` factory (7 keys) expanded, and the dynamic-def loop expanded (**13** defs without a custom page) |
| Operations in live `/docs/json` (scratch API, `API_DOCS=on`) | **430**, 329 paths | Normalised set diff against the static table: 0 only-in-docs, 0 only-in-table |
| Difference from the 10-17 inventory (429) | +`POST /api/pm-schedules/visits` (added 10-22) | — |
| 01's "427" | Wrong. A grep of `hasCustomPage:\s*true` matched a **comment** in `backup-format.def.ts:7`, while that def's property is `false`. The correct counts are 13 defs and 26 dynamic operations. | Corrects `01-architecture-audit.md` §1.2 |
| Public (no JWT) | 11 | `plugins/auth.ts:180-193`, plus exact-path `POST /api/admin-requests` (`:245`) |
| Signed-in, no permission check | 43 — **0 gaps**:<br>• auth plumbing (`/api/auth/*`), acting on `req.user` only<br>• notification read-state, scoped by `notifications/visibility.ts`<br>• photo upload<br>• in-handler gates (`report-export-log` via `REPORT_EXPORT_GATES`, QNN list via `canSeeQnn`, registry manifest)<br>• 19 `/config/*/current` reads and per-user config reads<br>• `GET /api/roles/access-matrix`, which shows every role's permission list to any signed-in user — intentional, INFO | CODE-READ |
| `/api/super-admin/*` | 41, every one `requireRole('SUPER_ADMIN')`, directly or through `dataPreHandler` / `dataMutationPreHandler` / `guarded` | CODE-READ |
| `POST /api/admin-requests/:id/process` | Its preHandler picks `ADMIN_REQUEST_APPROVE` or `_REJECT` from `body.action` (`admin-requests/routes.ts:209-213`). The schema enum is validated first. | CODE-READ |

### 2.2 Grant set ≠ gate, on the server — CODE-READ 2026-10-22
The CLAUDE.md leak rule says no node's grant set may contain another node's gate. On the server, that would show up as a route whose `requireAnyPermission` list includes a permission that some other configurable node hands out. The sweep checked every accepted permission P on every write route against every configurable `PERMISSION_TREE` node whose grant set contains P but whose gate does not.
- **No leak found.** Two benign hits:
  - `filters.rfid_manage` → `ASSET_IDENTIFIER_*` on `/api/assets/identifiers`. Same capability; the route also accepts `FILTER_RFID_MANAGE`.
  - `ASSET_READ` on two batch **reads** sent as POST (`filter-operations/routes.ts:974,1030`).
- **Per role** (install baseline and the clone's live roles, all six non-SA roles): no write route is reachable only through a permission that isn't some toggle's gate, and none only through a fallback.
- **`hasEffectivePermission` fallbacks** (`packages/shared/src/types/permissions.ts:257-275`):
  - `DASHBOARD_MANAGE` ⊇ create/view (intended).
  - `NOTIFICATION_MANAGE` ⊇ `NOTIFICATION_DELETE`. The node is enforced-only and only SA holds it (INFO, AZ-12).
  - `BACKUP_MANAGE` ⊇ `BACKUP_EXPORT`. SA only; `BACKUP_RESTORE` is correctly not implied.
  - `ASSET_READ` ⊇ `ASSET_VIEW` (by design, P4-06).
  - These fallbacks still have no automated test (02, BR-125).
- **Broad alternatives** (`ASSET_CREATE/UPDATE/DELETE`) appear on 12 write routes; only SA holds them. **SEC-06** is the exception: the generic instance routes accept the Filter toggles **and** the Block/Area/AHU toggles for every kind of instance.

### 2.3 Offline-replay grant — EXECUTED 2026-10-22
`OFFLINE_REPLAY_ROUTES` (`plugins/auth.ts:483-495`) holds exactly the six routes the sync engine replays (`git show a84ee0b:apps/web/src/lib/sync-engine.ts`). Probes, SUPERVISOR or OPERATOR on the scratch API:

| Probe | Result |
|---|---|
| Valid grant, no password, `POST /api/filters/<id>/retire` (not a replay route; the policy lists SUPERVISOR for `RETIRE_FILTER`) | **401 `REAUTH_REQUIRED`** — grant ignored, password still required |
| Valid grant, `POST /api/filters/bulk-operate` | Grant ignored; normal validation and gates applied (400 schema) |
| Valid grant, `POST /api/filters/<id>/advance` without `offlinePerformedAt` / `clientOpId` | **400 `OFFLINE_REPLAY_FIELDS_REQUIRED`** |
| Valid grant plus both fields, unknown filter | 404 — grant honoured, handler reached |
| Forged grant token on `/advance` | **401 `OFFLINE_REPLAY_TOKEN_INVALID`** |
| Another user's grant on `/advance` | **401 `OFFLINE_REPLAY_TOKEN_USER_MISMATCH`** |
| Bare `x-offline-replay: true` header | **401 `OFFLINE_REPLAY_HEADER_DEPRECATED`** |
| Garbage grant header on a non-replay route (`GET /api/auth/me`) | 200. The header is ignored there; the JWT alone authenticates. Not a bypass. |

---

## 3. Re-authentication (electronic signature) (scope 2)

### 3.1 Coverage — CODE-READ 2026-10-22
- **All 127 catalog actions are enforced at least once** once dynamic names are resolved: `withStageAction` / `reauthActionsForItems`, 12 `EXPORT_*` through `REPORT_EXPORT_ACTIONS`, 6 `STAGE_*`, `CONFIG_KEY_TO_ACTION`, and `def.reauthAction`. No catalog action is dead.
- **16 actions always ask for the password** (`enforceReauthAlways`, 13 call sites):
  - password policy, login security, session and date-time config;
  - access-matrix save;
  - audit templates, field IDs, report signatories and tablet access;
  - PM overdue acknowledge;
  - report review and approve;
  - stage approve, reject and bulk-decide;
  - the SA API-lock toggle.

  `POST /api/auth/offline-grant` checks the password itself.
- **The other 111 actions ask only when the caller's role is listed** in `system_config['action-reauth'][action]` (`lib/reauth-check.ts:222-227`). There is no SUPER_ADMIN special case either way. This is what SEC-01 and SEC-07 turn on.
- **44 write routes have no re-auth at all.** All are classified:
  - 9 auth plumbing;
  - 2 public submits;
  - 11 read-only POSTs (validate, test-connection, batch reads);
  - 6 user-scoped state changes;
  - 2 maintenance triggers;
  - 9 dashboard writes and 3 notification-template writes (audited; no catalog action exists for them);
  - 1 debug toggle;
  - **`POST /api/notification-settings/send` → SEC-03.**
- **Signatures inert under the shipped policy:** 31 policy rows list only roles that fail the route's permission check, so they ask no one for a password. The Action Re-auth page still shows them as "required". They include `DELETE_AUDIT_RECORD`, `DELETE_USER`, the role writes, `UPDATE_REAUTH_CONFIG`, and `START_CLEANING_CYCLE` with an empty list. This is part of SEC-01.

### 3.2 Dynamic checks — EXECUTED 2026-10-22 (clone policy, read-only via `/action-reauth/check`)
| Caller | Action | `required` |
|---|---|---|
| ADMIN | `UPDATE_REAUTH_CONFIG` | **false** |
| ADMIN | `DELETE_AUDIT_RECORD` | true (ADMIN cannot reach the route; SA can, unsigned) |
| QA | `APPROVE_FILTER` | **false** |
| QA | `APPROVE_REPLACEMENT_SCHEDULE` | **false** |
| OPERATOR | `START_CLEANING_CYCLE` | false (empty role list; configuration, as recorded 10-17) |

| Probe | Result |
|---|---|
| QA `POST /api/assets/instances/approve` (random filter id), no password | **404** — the handler was reached, so the approval is **unsigned** (SEC-07) |
| QA `POST /api/replacement-schedules/entries/approve` (random id), no password | **404** — unsigned (SEC-07) |
| ADMIN `PUT /api/config/password-policy` (unchanged value), no password | **401 `REAUTH_REQUIRED`** (gate active) |
| Same, password in body only | 200 — for a role the policy row lists. SEC-10's unlisted-role case was not probed. |
| Same, password in header | 200 |
| ADMIN `PUT /api/config/action-reauth` with an unknown action name, no password | **403** — in the clone only SUPER_ADMIN holds `ROLE_MANAGE`. The unsigned policy save therefore affects SA only and is part of SEC-01 (decided). |

These two writes changed the clone. Both `password-policy` saves stored the unchanged value, writing 2 `CONFIG_CHANGED` and 2 `REAUTH_SUCCESS` rows to `digilog_qa_perf`. Note that a save resets the policy-save timestamp, which is one of the password-expiry anchors on the clone.

### 3.3 `_currentPassword` handling — CODE-READ + EXECUTED 2026-10-22
- **Code:** the password is stripped inside both gates before any early return, including "role not listed" and offline replay (`lib/reauth-check.ts`). No route without a gate persists `req.body` wholesale.
- **Marker probe (sacrificial OPERATOR, two wrong attempts, then one correct attempt to reset the counter):**
  - Sent: a unique marker as the body `_currentPassword`, as `x-reauth-password`, as `x-offline-replay-token`, and as the `/verify` password.
  - Logs: 0 hits for the marker in any scratch log channel or in WinSW stdout.
  - Database: 0 hits in `digilog_qa_perf` `audit_trail` (before/after/reason/user-agent), `system_config` and `notifications`.
  - The failed attempts were audited as 2 × `REAUTH_FAILED`. The account's `failed_login_attempts` was back to 0 afterwards.
  - The perf password literal appears in no log file. No `Bearer` token appears in any log.

---

## 4. Input handling (scope 3)

| Control | Result | Evidence |
|---|---|---|
| uuid path parameters | 144 of 151 `:id`-style parameters enforce uuid format; the other 7 are names or keys by design. **Probes:** `GET /api/hierarchy/filters/not-a-uuid`, `POST /api/filters/not-a-uuid/advance`, `GET …/current-state`, `DELETE /api/notifications/not-a-uuid`, `GET /api/users/not-a-uuid` and `?filterId=abc` all return **400 `VALIDATION_ERROR`**; none returns a 5xx. | CODE-READ + EXECUTED |
| Date-range guard (`lib/date-range-guard.ts`, global preHandler registered before the routes) | Inverted `from/to` on `/api/audit` → **400 `INVALID_DATE_RANGE`**. A non-date `from` is ignored (200). A same-day range → 200. | EXECUTED |
| Body limits | 5 KB login body → **413 `BODY_TOO_LARGE`** (4 KB route limit). 11 MB JSON to a public route → **413**. | EXECUTED |
| Bulk array and free-text bounds | No `maxItems` on 39 bulk-array write routes and no `maxLength` on approval remarks (SEC-15) | CODE-READ |
| Photo upload | Text file named `.png` → **400 `INVALID_FILE`** (magic bytes). `text/html` → **400 `INVALID_FILE_TYPE`**. 6 MB file with a PNG signature → **413 `FILE_TOO_LARGE`** (5 MB default). Filename `../../../evil.png` → stored as the generated `/uploads/photos/<uuid>-<uuid>.png`. JSON sent to the multipart route → **400 `INVALID_REQUEST`**. | EXECUTED |
| Static uploads | `/uploads/photos/../../.env` and `%2e%2e` → **401**; `..%2f..%2f.env` → **404**. No file content leaked. `/uploads/*` needs a JWT on this build. | EXECUTED (SI-16 hypothesis not reproduced for these encodings) |
| Multipart limits | Only `fileSize` and `files` are set; `fields`, `fieldSize`, `parts` and `headerPairs` are at busboy defaults (SEC-16) | CODE-READ |
| Spreadsheet imports | `exceljs` loads the whole workbook, and only the 5 MB compressed size is bounded (SEC-05) | CODE-READ — HYPOTHESIS, **not executed** (§9) |
| CSV/XLSX formula injection | Server exports (PM, replacement) neutralise `= + - @ TAB CR` (`lib/spreadsheet-safe.ts`); the web export writer and the reversible backup CSV are covered too. The 2026-07-25 S3 fix is still in place. | CODE-READ |
| Raw SQL | 35 `*RawUnsafe` calls; the 9 with interpolation use only database-sourced trigger/relation names or the restore keep-table name | CODE-READ |

---

## 5. Secrets, configuration, SSRF, rate limits, headers, CORS (scopes 4 and 5)

| Control | Result | Evidence |
|---|---|---|
| Swagger fail-closed | With `API_DOCS=off`, `/docs`, `/docs/json` and `/docs/static/index.html` answer exactly like an unknown path (401). The installer never sets `API_DOCS`. | EXECUTED + CODE-READ (`app.ts`, `scripts/install.ps1:179`) |
| TLS | TLS 1.0 and 1.1 refused by the server (alert 70 `protocol_version`, with the client forced to SECLEVEL=0). TLS 1.2 (`ECDHE-RSA-AES128-GCM-SHA256`) and TLS 1.3 (`TLS_AES_256_GCM_SHA384`) accepted. HSTS: `max-age=31536000; includeSubDomains`. | EXECUTED (`openssl s_client`) |
| Security headers (`/api/health`) | CSP `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`, COOP and CORP `same-origin`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`. The same set is sent on refused `/uploads` requests. | EXECUTED (`curl -I`) |
| CORS | A preflight from `https://evil.example` or `Origin: null` gets **no** `Access-Control-Allow-Origin`. An `ALLOWED_ORIGINS` entry is echoed. `allowedHeaders` = Content-Type, Authorization, `x-reauth-password`; the offline-grant header is absent (INFO-06). Boot fails in production without `ALLOWED_ORIGINS` (`app.ts:181-184`). | EXECUTED + CODE-READ |
| Rate limits (exactly three, operator decision 2026-10-10) | `POST /login`: 115 parallel requests from one client → **95 × 401 + 20 × 429**, i.e. the 100/min bucket. A request with spoofed `X-Forwarded-For` / `X-Real-IP` sent right after the burst → **429** (proxy headers not trusted). **Note:** sequential guessing from one client cannot exceed about 80/min anyway, because a failed login takes about 0.6–0.8 s (bcrypt plus timing equalisation). 105 sequential attempts never reached the limit. `/verify` and `/change-password` keep their 50/min limits (code). | EXECUTED (in-memory limiter of the scratch process only) |
| Rate-limit key | `rateLimitKeyGenerator`: IPv4 exact, IPv4-mapped IPv6 → IPv4, other IPv6 → /64 | CODE-READ (`lib/rate-limit-key.ts`) |
| JWT | HS256 pinned; secret required in production; offline-grant HMAC bound to user and session, 24 h | CODE-READ |
| Logger redaction | Explicit paths in `lib/logger.ts:223-244`. `_currentPassword`, `x-offline-replay-token`, `bindPassword`, `clientSecret` and several SMS secrets are missing (SEC-11). Not live today, because no request body or header set is logged (marker probe, §3.3). | CODE-READ + EXECUTED |
| OAuth2 callback | The public `GET /api/notification-settings/email/oauth2/code?code=…&state=…` is written to `logs/app/http` with the full query (SEC-12) | EXECUTED (marker code and state found at `http.2026-10-22.1.log:154-155` of the scratch run) |
| SSRF guard (`lib/ssrf.ts`) | Every HTTP fetch to an admin-typed URL (instrument readings, SMS, OAuth2 token endpoints, delivery test) goes through `hardenedFetch` / `checkOutboundUrl`. The resolved address is **not pinned** for the connection (DNS rebinding, SEC-14). **LDAP and SMTP get no destination check** (SEC-08). | CODE-READ + EXECUTED (LDAP) |
| LDAP test-connection as ADMIN (`CONFIG_UPDATE`, no password) | `ldap://127.0.0.1:5432` → `read ECONNRESET` (221 ms, port open). `ldap://127.0.0.1:1` → `connect ECONNREFUSED` (66 ms). `ldap://169.254.169.254:389` → `Connection timeout` (3 s). The server connects to loopback and link-local, and the messages work as a port-scan oracle. | **EXECUTED** (SEC-08 confirmed) |
| Secrets in tracked files | No private key, cloud key or token found. Known tracked credentials: the synthetic perf password (`tests/performance/README.md:18`); a local Postgres password in `tests/performance/start-perf-api.ps1:45` and as the default in `tests/performance/data-generation/perf-env.ts:24`; the documented initial SA password in CLAUDE.md (forced change on first login); and A-09 (RFID scanner signing passwords, `rfid_scan_app/app/build.gradle.kts:16,18`). Git history still holds the scanner keystore and old secrets; by hash comparison those differ from the current ones. Values are not reproduced here. | CODE-READ (pattern scan of `git ls-files` and `git log --all`) |
| Tablet CA | `res/raw/rootca.pem` is an inert placeholder (`CN=FMS placeholder CA - no private key exists - replace per site`, CA:TRUE, valid to 2056) | CODE-READ (`openssl x509`) |
| Server secrets on disk | No install script sets ACLs on `digilog.env`, `rootCA.key`, `server.key` or the nightly dumps (SEC-04) | CODE-READ — HYPOTHESIS (needs the VM) |

---

## 6. Audit-chain integrity (scope 6)

| Check | Result | Evidence |
|---|---|---|
| Chain on the disposable clone | **Intact.** `digilog_qa_perf`: 35,783 rows, chain positions 21,980–57,762, 0 anomalies, 0 signed-row false positives, 2.7 s, using the app's own `verifyAuditChain` (`tests/performance/data-generation/verify-perf-chain.ts`, read-only). The chain begins at position 21,980 because the 2026-10-07 operational wipe deleted the earlier rows; a deleted head is undetectable by design (only gaps between rows are flagged). | EXECUTED |
| DB triggers | `audit_trail_no_delete` only. There is no UPDATE trigger and no TRUNCATE guard, and the app role owns the table (SEC-18). | CODE-READ (`prisma/sql/invariants.sql:119-132`, baseline) |
| `signature_audit_id` | Inside the checksum only when present; the verifier reads it (10-17 fix still in place) | CODE-READ |
| Redaction | Chain-preserving and audited. **At `a84ee0b` the verifier accepts any redacted row whose payloads are NULL, whatever its other columns say** (SEC-02). | EXECUTED (verifier function, see SEC-02); redaction through the API: dynamic pending SA session |
| Hard delete | Writes the meta-row first; the trigger is disabled and re-enabled inside the transaction (SHARE ROW EXCLUSIVE lock). Breaks the chain, which stays loud by design (ACCEPTED 2026-07-01). Meta rows themselves can be hard-deleted (SEC-19). Unsigned for SA under the shipped policy (SEC-01). | CODE-READ; dynamic pending SA session (random-id probes only) |
| Restore | `preserveUnbackedAuditRows` keeps live audit rows a backup lacks (CODE-READ). **The test cited in 02 as AUTO-NEW evidence for BR-100/101 (`backup-restore-scratch`) is quarantined** (`e2e/backup-restore-scratch.QUARANTINED.ts.txt`), so that runtime evidence is not available. | CODE-READ |
| `AUDIT_CHAIN_KEY` | Optional in production. Without it new rows are unkeyed V2 and the deployment check does not say so (SEC-17). The installer always generates it. | CODE-READ |

---

## 7. Dependency vulnerabilities (scope 7) — EXECUTED 2026-10-22

`npm audit --omit=dev --json` (npm 11.11.0), run at the root and with `-w` for each workspace (`@digilog/api`, `@digilog/web`, `@digilog/shared`, `android`). One shared lockfile. No `fix` was run and no dependency was changed. Raw JSON is in the agent's scratchpad (§10). **Gradle dependencies (Capacitor Android native and the Kotlin RFID scanner) are not covered by `npm audit`, and no Gradle scan was run.**

| Package | Severity | Direct? | Path | Advisories (summary) | Runtime relevance |
|---|---|---|---|---|---|
| `@capacitor/android` 8.3.0 | **critical** | yes (`apps/android`) | tablet APK | GHSA-rvm3-566m-v7fv: remote content can be loaded at the app origin via the internal HTTP proxy path (≤ 8.3.4) | **Tablet app.** Fix by upgrading to > 8.3.4 and rebuilding the APK (no rebuild this session, per operator decision). |
| `@fastify/busboy` 3.2.0 | high | via `@fastify/multipart` 9.4.0 | API | DoS via oversized multipart boundary; DoS via prototype-named part header; CRLF in Content-Disposition (< 3.2.2) | **API, reachable by any signed-in user** (photo upload is auth-only) |
| `nodemailer` 9.1.1 | high | yes | API | address-parser quadratic backtracking DoS (≤ 10.0.5); nested-recipient stack exhaustion; DNS-cache servername reuse across transports; malformed envelope recipient | API, only when SMTP is configured. Recipients come from admin-configured users, plus SEC-03's free-text recipient. |
| `sanitize-html` 2.17.7 | moderate | yes | API | `noscript` region bypass; SMIL `javascript:`; `meta refresh` URL (< 2.18.0) | API text stripping (11 call-site files). The web never renders stored HTML, so this is low. |
| `ip-address` 10.5.0 | moderate | via `@fastify/rate-limit` | API | link-local / NAT64 classification; cross-family subnet compare; unbounded parse diagnostic | Low: the app's own `lib/rate-limit-key.ts` and `lib/ssrf.ts` use `node:net` |
| `prisma` / `@prisma/config` / `deepmerge-ts` | high | yes (`prisma` is a runtime dependency of `apps/api`) | API tooling | deepmerge-ts stack exhaustion | Migration/CLI tooling, not the request path |
| `source-map-js` | high | via prisma/magicast and sanitize-html (postcss) | API | event-loop DoS on crafted source maps | Not fed untrusted input |
| `brace-expansion` | high | via `@fastify/static` → glob, exceljs → archiver | API, web | quadratic expansion | Patterns are not user-controlled |
| `dompurify` 3.4.13 | low | via `jspdf` | web | `IN_PLACE` hook issues | jsPDF HTML path not used with untrusted HTML |

Totals: **root 11** (1 critical, 7 high, 2 moderate, 1 low); `@digilog/api` 9 (7 high, 2 moderate); `@digilog/web` 3 (2 high, 1 low); `@digilog/shared` 1 high (npm's workspace scoping attributes the hoisted `source-map-js` to it); `android` 1 critical.

---

## 8. Defects and risks

### 8.1 P1

| ID | Title | Evidence (`a84ee0b`) | Failure scenario | Proposed fix | Status |
|---|---|---|---|---|---|
| **SEC-01** (= AZ-01 / SI-02 / OD-01 of 2026-07-15) | **A SUPER_ADMIN performs the destructive and record-rewriting §11 actions without an electronic signature, and no screen can change that** | Policy-only gates (`enforceReauth`):<br>• audit edit, redact, bulk-redact, hard delete, bulk delete (`modules/audit/routes.ts:584,647,763,861,927`)<br>• every Filter Data Management write (`super-admin/manual-change.ts:12-13`, `SUPER_ADMIN_DATA_EDIT`)<br>• user delete (`users/routes.ts:81,318`) and role CRUD (`roles/routes.ts:194,247,311`)<br>• role/user permission saves (`config/static-routes/roles.routes.ts:98,173`)<br>• 13 SA-only workflow configs (`dynamic-routes.ts:65-79`)<br>• the re-auth policy itself (`action-reauth.routes.ts:53`)<br><br>`prisma/install-baseline.json` and the clone list SUPER_ADMIN in only **2 of 73 / 84** policy rows. Both policy editors leave SA out of the role columns (`apps/web/src/routes/config/action-reauth.tsx:137-141`, `role-access.tsx:48-51`). | An SA session left open at a workstation, or a stolen SA token:<br>• `DELETE /api/audit/<id> {reason}` → 200, the chain is broken permanently, and the meta-row carries no `signature_audit_id`; or<br>• Filter Data Management edits a cleaning cycle or unretires a filter (which hard-deletes the replacement's history), with no password.<br><br>Meanwhile the Action Re-auth page shows `DELETE_AUDIT_RECORD` and `DELETE_USER` as "required", but only for roles that cannot perform them. | Use `enforceReauthAlways` for:<br>• `UPDATE/DELETE/BULK_DELETE/REDACT/BULK_REDACT_AUDIT_RECORD(S)`<br>• `SUPER_ADMIN_DATA_EDIT`<br>• `UPDATE_REAUTH_CONFIG`<br>• `UPDATE_ROLE_CONFIG` / `UPDATE_USER_CONFIG` (roles routes)<br>• role CRUD<br>• `DELETE_USER` / `BULK_DELETE_USERS`<br><br>Also flag policy rows whose listed roles cannot reach the action. | **DECIDED 2026-10-22** (`test-results/README.md` OD-01: always ask for the password, every user including SA, not configurable). **Fix not committed** at 11:57 UTC. **Dynamic pending SA session**: `QA/tests/security/sa-session-probes.mjs` Part A (§9). |
| **SEC-02** (= SI-01) | **Redacted audit rows escape tamper detection** | `apps/api/src/lib/hash-chain.ts:286-288` (at `a84ee0b`): `if (record.redactedAt != null) return beforeValue == null && afterValue == null;`. User, role, action, timestamp, target, reason and IP of a redacted row are never verified, and nothing requires a matching `AUDIT_RECORD_REDACTED` row. | Someone with database credentials (the chain's own threat model; there is no UPDATE trigger) sets `redacted_at=now()`, nulls the payloads and rewrites `user_id` / `timestamp` / `target_id` on a `FILTER_APPROVED` or `CYCLE_COMPLETED` row. `GET /api/audit/verify-chain` still reports the chain intact, **even with `AUDIT_CHAIN_KEY` set**.<br><br>**Proof (EXECUTED):** the `a84ee0b` verifier, run as a pure function with no database:<br>• control row (not redacted, wrong checksum) → `false`<br>• redacted row with rewritten user, action and timestamp and the same stored checksum → **`true`** | Verify redacted rows against their redaction record (its snapshot holds id, action, timestamp, user and target) and fail on absence or mismatch, or add a keyed envelope checksum over the non-payload columns | **Fix in progress** in the working tree: `lib/audit-redaction.ts` (new), `RedactionEvidence` / `verifyRedactedRow` in `hash-chain.ts`, and the new test `e2e/audit-redaction-integrity.test.ts`. Uncommitted and not verified by this report. Post-fix runtime check: **dynamic pending SA session** (`sa-session-probes.mjs --tamper`, Part B). |

### 8.2 P2

| ID | Title | Evidence | Failure scenario | Proposed fix | Status |
|---|---|---|---|---|---|
| SEC-03 (AZ-04) | `POST /api/notification-settings/send` sends arbitrary e-mail or SMS with no audit row, no signature and no UI caller | `notification-delivery/routes.ts:530-551` (`CONFIG_UPDATE`; free `recipient` / `subject` / `message`, no `maxLength`); `delivery.service.ts` writes only `notification_logs` | An ADMIN sends phishing mail or premium-rate SMS from the site's trusted SMTP/SMS gateway to any address. Nothing appears in the hash-chained trail. | Remove the route. If it is kept: SA only, always-on re-auth, an audit row, length bounds, and recipients limited to users and groups. | CODE-READ (not sent: it would deliver to a real gateway if one is configured). **FIXED 2026-10-22 (operator decision: remove):** the route is gone and answers 404 like any unknown path; `/email/test` and `/sms/test` stay and each writes a `NOTIFICATION_TEST_SENT` audit row (who, channel, recipient, `SEND` / `CONNECTION_CHECK`, success; never the error text or a config value). Guard: `e2e/notification-settings-routes.test.ts`, SEC-03 block. |
| SEC-04 (SI-03) | Secrets, keys and dumps on the installed server get no ACL hardening | No `icacls` / `Set-Acl` anywhere in `scripts/`; `scripts/install.ps1:47-51,94,153-200`; `issue-lan-cert.ps1:39-42`; `backup-db.ps1:49-50` | A non-admin Windows account on the server reads `C:\ProgramData\DigiLog\config\digilog.env` (ProgramData grants Users read by inheritance). That account can then:<br>• forge a JWT for an active SA session;<br>• use the DB password and `AUDIT_CHAIN_KEY` to rewrite audit rows and re-key them;<br>• use `rootCA.key` to impersonate the server to every tablet. | `icacls <DataRoot>\config <DataRoot>\certs <DataRoot>\backups /inheritance:r /grant:r SYSTEM:(OI)(CI)F Administrators:(OI)(CI)F` in install and upgrade, plus a deployment-check assertion | HYPOTHESIS: needs `icacls` on the clean VM (deliverable 10) |
| SEC-05 (SI-04) | A small `.xlsx` that expands hugely can exhaust the single API process | `exceljs` loads the whole workbook (`assets/services/bulk-upload-filter.service.ts:103-113`, `pm-schedules/routes.ts:79`, `replacement-schedule/service.ts:63-64`); only the 5 MB compressed size is bounded; `/bulk-upload-filters/validate` has no re-auth (`instance.routes.ts:494-520`) and SUPERVISOR / SHIFTOFFICER hold `FILTER_BULK_UPLOAD` | A bulk-upload holder sends a crafted workbook → heap exhaustion → the one API process (all users, cron jobs) restarts | Before `xlsx.load`, read the zip central directory (`adm-zip` is already a dependency) and refuse when the total uncompressed size or the compression ratio exceeds a bound, as backup restore already does (`backup.service.ts:20,430`) | HYPOTHESIS. **Not executed** in this assessment; the fix is cheap and recommended either way. |
| SEC-06 (AZ-03) | Generic instance create / edit / delete accept a Filter toggle's permission for a Block / Area / AHU, and the reverse | `assets/routes/instance.routes.ts:272,653,805,827` accept `ASSET_* \| FILTER_* \| FILTER_HIERARCHY_*` with no kind check (the bulk route checks kind at `:440`) | A role granted only "Delete Filters" deletes a Block with its password, cascading deactivation and identifier removal to everything beneath it. No live role holds an unpaired combination today (latent). | Resolve the template kind in the handler and require the matching toggle's permission | CODE-READ |
| SEC-07 (AZ-09) | Filter and replacement-schedule approval decisions are unsigned for the roles that make them (baseline and clone) | `REVIEW/APPROVE/REJECT_FILTER` and the replacement review/approve/reject/review-edit rows do not list MANAGER or QA; stage approvals and report reviews always ask | QA approves a new filter or a replacement schedule with no password and no signature record, while the same QA's stage approvals are signed | Add the rows to the install baseline, or make these decisions `enforceReauthAlways` like stage approvals. **Operator decision** (it is configuration). | **EXECUTED**: QA approve with no password reached the handler (404 on a random id) |

### 8.3 P3

| ID | Title | Evidence | Proposed fix | Status |
|---|---|---|---|---|
| SEC-08 (SI-06) | LDAP (test-connection and login bind) and SMTP host get no destination check. An ADMIN can make the server connect to loopback and link-local addresses, and the error text works as a port-scan oracle. This breaks the CLAUDE.md rule "outbound calls to admin-typed URLs must use `lib/ssrf.ts`". | `ldap/ldap.service.ts:146,162,181,245`; `notification-delivery/channels/email-channel.ts:188-225`; test-connection needs no password and returns raw `err.message` | Resolve the host, apply `isBlockedAddress` (private LAN stays allowed), and return a generic failure text | **EXECUTED** for LDAP (§5); SMTP not probed |
| SEC-09 (AZ-05) | One user's "mark read" on a role-addressed notification marks it read for the whole role | single `isRead` column (`schema.prisma:381`); `notification.repository.ts:48-73` | Per-user read state | CODE-READ. Probe inconclusive (the second QA user had 0 unread). |
| SEC-10 (AZ-06) | A body-only password is consumed by the first of the two gates on a config factory route when the caller's role is not in the policy row | `config/routes.ts:128-158`; `lib/reauth-check.ts:257-263` | Keep the verified password on the request for later gates | CODE-READ. The probe with a **listed** role (ADMIN) succeeded with a body-only password; the unlisted-role case was not run. The web client sends both body and header, so it is unaffected. |
| SEC-11 (AZ-07 / SI-10) | Logger redaction misses `_currentPassword`, `x-offline-replay-token`, `bindPassword`, `clientSecret`, SMS secrets and two-level paths; `PrismaClientValidationError` messages (which embed arguments) are logged | `lib/logger.ts:223-244`; `lib/error-handler.ts:168-179` | Add the names; log the error class and route, not `.message` | CODE-READ. Not live today (marker probe, §3.3). |
| SEC-12 (AZ-08) | The OAuth2 `code` and `state` of the public callback are written to the 7-day http log | `app.ts:378` (`url: req.url`) | Strip the query for that path | **EXECUTED** |
| SEC-13 (new) | **Login rate-limit refusals (429) never reach the security channel.** The onResponse security logging excludes `/api/auth/login` because the login handler logs its own lines, but a 429 is answered before the handler runs. The one event that marks password guessing is therefore only in `http/` and `error/`. | `app.ts:414-424` | Exclude only the non-429 login statuses | **EXECUTED**: 74 × 429 in `http/` and `error/`, 0 in `security/` |
| SEC-14 (SI-05) | The SSRF guard does not pin the checked address (DNS-rebinding window) | `lib/ssrf.ts` (`lookup` then `fetch(url)`); `equipment-groups/instrument-fetch.ts:59-68` | undici `Agent` with a `connect.lookup` that checks and connects to the same address | CODE-READ |
| SEC-15 (SI-07 / SI-08) | No `maxItems` on 39 bulk-array writes; no `maxLength` on approval / decision remarks. Each item writes an audit row under the single global audit lock. | §4; `lib/audit.ts:194` | `maxItems` matching the UI batch sizes; `maxLength` ≈ 2,000 | CODE-READ (bulk-operate uncapped is ACCEPTED 2026-09-04) |
| SEC-16 (SI-09) | Multipart `fields` / `fieldSize` / `parts` / `headerPairs` are left at busboy defaults | `app.ts:274-280` | Set tight limits | HYPOTHESIS |
| SEC-17 (SI-11) | `AUDIT_CHAIN_KEY` is optional in production; without it new rows are silently unkeyed and the deployment check does not flag it | `lib/hash-chain.ts:35-40`; `lib/audit.ts:231-238` | Fail boot in production when the key is unset (as for `JWT_SECRET`) | CODE-READ |
| SEC-18 (SI-12) | DB-level immutability blocks DELETE only: TRUNCATE and UPDATE are not blocked, and the app role owns the table | `prisma/sql/invariants.sql:119-132` | `BEFORE TRUNCATE` statement trigger; long term, an insert-only role for `audit_trail` | CODE-READ |
| SEC-19 (SI-13) | Hard delete does not refuse the meta rows (`AUDIT_RECORD_*`) that edit protects with `META_AUDIT_IMMUTABLE` | `modules/audit/routes.ts:866-889` vs `:783` | Refuse meta actions on delete and bulk delete | CODE-READ (not scripted for the SA session: proving it means deleting a real row, which breaks the clone's chain permanently; verify with an e2e test on the fix instead) |
| SEC-20 (A-12) | Session duration is still read from the legacy `session` row, while idle logout reads the Password Policy | `plugins/auth.ts:26-37` | One source | CODE-READ (still present since 10-21) |

### 8.4 INFO

- **INFO-01** Failed logins for **non-existent** user IDs are recorded only in the 7-day `security/` log, not in `audit_trail`. EXECUTED: 610 security-log lines for the probe user, 0 audit rows. Wrong passwords for existing users are audited as `LOGIN_FAILED`.
- **INFO-02** `GET /api/roles/access-matrix` returns every role's permissions to any signed-in user (intentional, Module Guide).
- **INFO-03** `NOTIFICATION_MANAGE` implies `NOTIFICATION_DELETE` through the fallback (only SA holds it).
- **INFO-04** Non-production 403 bodies name the missing permission (`plugins/rbac.ts`).
- **INFO-05** The backup-restore 4xx branch forwards `err.message` of framework errors carrying a 4xx `statusCode` (`backup/routes.ts:219-224`). The 500 path is fixed (A-04).
- **INFO-06** CORS `allowedHeaders` lacks `x-offline-replay-token`. The tablet is unaffected, because it uses native CapacitorHttp (`apps/android/capacitor.config.ts`); a cross-origin browser replay (dev Vite) would fail preflight.
- **INFO-07** The public-path matcher compares raw `req.url` prefixes (`plugins/auth.ts:171-177,194`). The traversal encodings tried were refused (§4).
- **INFO-08** helmet's `Cross-Origin-Resource-Policy: same-origin` also applies to `/uploads/photos/*`; check profile photos on the tablet.
- **INFO-09** CLAUDE.md says the trigger toggle takes ACCESS EXCLUSIVE; `ALTER TABLE … DISABLE TRIGGER` takes SHARE ROW EXCLUSIVE. That still blocks writers, so the claim about the window holds. Doc wording only.
- **INFO-10** 16 e2e files still install their own inline error handler (A-05 residual); the harness itself now uses `buildErrorHandler`.
- **INFO-11** Tracked dev / perf credentials and the documented initial SA password (§5); the RFID scanner keystore and old secrets remain in git history. Rotate the scanner key if that app is distributed.
- **INFO-12** The scratch API served the dev mkcert certificate, whose SAN lists dev host names and IPs. Customer installs issue their own (`issue-lan-cert.ps1`).

### 8.5 Accepted risks (scope 8) — operator decisions, tested as such, not defects

| Risk | Decided | Source |
|---|---|---|
| A-08: tablet WebView permits cleartext HTTP and trusts user-installed CAs (`network_security_config.xml`, `AndroidManifest.xml:16-17`, `capacitor.config.ts` `allowMixedContent`) | 2026-10-21 | `test-results/README.md` "A-08 / A-09" |
| A-09: RFID scanner signing passwords in a tracked build file | 2026-10-21 | same |
| SUPER_ADMIN exempt from lockout and expiry; no MFA | 2026-07-25 | memory `feedback_super_admin_exempt_no_mfa_2026_07_25`; CLAUDE.md "three rate limits" note |
| Only three rate limits (login 100/min, verify 50/min, change-password 50/min); guest cleaning request unlimited | 2026-10-10 | CLAUDE.md |
| Contact Admin lookup returns the real name and role | 2026-10-01 | memory `project_contact_admin_changes_2026_10_01` |
| Offline-replay grant issuance not audited | 2026-08-27 | CLAUDE.md FDM retrofit |
| Audit hard delete breaks the chain and stays loud | 2026-07-01 | CLAUDE.md |
| FDM replacement edit / delete breaks the chain (`chainBroken:true`) | 2026-08-27 | CLAUDE.md |
| SA API lock fails open on a database read error | documented behaviour | `lib/super-admin-lock.ts:46-47`; `01` §3 |
| Offline replay exempts the interlock / AHU / block-change / missed-PM gates, recorded in `replayExemptGates` | 2026-09-24/25; offline approval exemption 2026-10-19 | CLAUDE.md; `QA/DEFECT_REGISTER.md` OQ-01 |
| bulk-operate has no item cap | 2026-09-04 | `filter-operations/routes.ts:671` comment |
| Filter bulk upload has no row cap (SEC-05 still applies to its uncompressed size) | 2026-10-08 | `bulk-upload-filter.service.ts:107` comment |

---

## 9. Not done, and why

| Item | Why | What is needed |
|---|---|---|
| SUPER_ADMIN runtime probes — **dynamic pending SA session** (team-lead decision 2026-10-22): SEC-01 (audit edit / delete / bulk-delete / redact / bulk-redact, FDM edit + delete, user delete + bulk delete, role update + delete, role / user permission saves, re-auth policy save, API-lock toggle — all WITHOUT a password), SEC-02 after its fix (DB-level rewrite of a redacted row must break `verify-chain`), signed redaction + `signatureAuditId` on its meta row, `verify-chain` through the API, SA-only reads, and the same SA-only routes refusing ADMIN | No SA credential: the operator types it once (README); one combined SA session at the end | Ready-to-run: start `bash QA/tests/security/start-scratch-api.sh off`, check `node QA/tests/security/sa-session-probes.mjs --dry-run` (pre-flight only — verified 2026-10-22), then run `node QA/tests/security/sa-session-probes.mjs --tamper` (hidden password prompt, or `--password-file`). Part A expects **401 `REAUTH_REQUIRED`** on all 15 unsigned probes once the OD-01 fix is in (404 / 400 = SEC-01 still open; every probe uses a random id or unknown name, so nothing changes either way). Part B expects verify-chain intact before and after a signed redaction of the SA's own login row, `signatureAuditId` on the `AUDIT_RECORD_REDACTED` row, `--tamper` → **intact=false** (SEC-02 fixed) and intact again after the automatic revert, signed delete of a random id → 404. Part C expects **403** for ADMIN on 8 SA-only routes. Results go to `QA/results/security/` (git-ignored). Hard delete of a REAL row (SEC-19) is deliberately not scripted: it breaks the clone's chain permanently. |
| SEC-05 spreadsheet-expansion probe | Not executed in this assessment | Decide whether to run it at all; implement the pre-check regardless |
| SEC-04 ACLs | Needs an installed server | `icacls` on the clean VM (deliverable 10) |
| SEC-03 send route | Would deliver real mail / SMS if the clone has a gateway configured | Static evidence suffices; remove or harden the route. **Moot since 2026-10-22: the route was removed.** |
| SMTP destination check (SEC-08, SMTP half) | Avoided an outbound SMTP attempt | Same fix as LDAP |
| Role-by-role authorization sweep (QA Phase 4, 2,574 requests, 2026-10-21) | **Not carried forward.** 30 route/plugin files changed between `7cb6dba` and `a84ee0b` (`git diff --name-only`), so the 10-21 results describe older gates. This report re-derived every gate statically at `a84ee0b` (§2) and probed a subset. | Re-run `QA/tests/phase4/role-sweep.mts` against the scratch API once the in-flight fixes land |
| Write-path abuse (QA Phase 5, 2026-10-21) | Same: CARRIED FORWARD only as history (0 authorization / mass-assignment / IDOR escalations then). Its re-auth and replay results pre-date the P5-02 fix, which is re-tested in §2.3. | Re-run `QA/tests/phase5/*.mjs` on the same build |
| Gradle / Android native dependency scan | `npm audit` does not cover it | OWASP dependency-check or `gradle dependencies` plus an advisory lookup |

---

## 10. Re-verified earlier findings (status at `a84ee0b`)

| Earlier item | Status | Evidence |
|---|---|---|
| BR-086 / A-02: a legacy policy shape silently disables gates | **FIXED**: converted to the rules it describes; the health flag is kept | `lib/reauth-check.ts:167-203` |
| A-02: unknown action names / roles saved | **FIXED**: 400 listing both | `config/config.service.ts:369-387` |
| A-03: stage-approval "different approver" switch | **FIXED**: removed; always on; fails closed with no caller id | `stage-interlock.def.ts:40`; `stage-approvals/service.ts:71-76` |
| A-04: raw `err.message` (backup restore, deployment check) | **FIXED** for the 500 paths; residual 4xx passthrough (INFO-05) | `backup/routes.ts:225-233`; `deployment-check/routes.ts:20-23,64-73` |
| A-05: error handler duplicated in the e2e harness | **FIXED** for the harness (`buildErrorHandler`); 16 e2e files still inline their own (INFO-10) | `app.ts:300`; `e2e/test-helper.ts:66` |
| A-06: filter reviewer may reject at the approval step | **FIXED** | `filter-approval.service.ts:89-93,186-197` |
| A-07: SoD guards fail open on a missing caller id | **FIXED** (filter, PM, replacement) | `filter-approval.service.ts:84-88`; `pm-approval.ts:123-125`; `replacement-schedule/workflow.ts:64-66` |
| A-08, A-09 | **STILL PRESENT — ACCEPTED 2026-10-21** | §8.5 |
| A-11: SA console RFID `trim()` only | **FIXED** (`canonicalRfidValue`) | `super-admin/rfid-event-edit.ts:18,82-85` |
| A-12: session duration source | **STILL PRESENT** (SEC-20) | `plugins/auth.ts:26-37` |
| OD-01 (2026-07-15): SA audit delete with no gate or signature | **DECIDED 2026-10-22, fix pending** (SEC-01) | §8.1 |
| P5-02: offline grant scope | **FIXED**, EXECUTED today | §2.3 |
| 2026-07-25 S3: spreadsheet formula injection | **FIXED, still in place** | `lib/spreadsheet-safe.ts` |
| 2026-08-18 SAST-01: SSRF guard | **In place for HTTP**; gaps SEC-08, SEC-14 | §5 |
| 2026-08-18 DEP-5: IPv6 /64 rate-limit key | **In place**, EXECUTED (spoofed `X-Forwarded-For` refused) | §5 |
| 2026-05-20 H2: `trustProxy` spoofing | **In place** (default false) | `app.ts:120-137`; EXECUTED |
| F-01 / API-07: Swagger fail-closed | **In place**, EXECUTED | §5 |
| 2026-10-17: verifier false positives on signed rows | **Fixed, still in place**: 0 signed-row false positives on the clone | §6 |

### Evidence files (agent scratchpad `C:\Users\hello\AppData\Local\Temp\claude\C--Users-hello-21cfrlogbook-DigitalFMS\b0eb7933-5ac2-4a74-9db1-1b2a29e7de92\scratchpad\`)
- `sec-routes.tsv`: 430-operation route table with gates and re-auth.
- `docs-json-a84ee0b.json`: live OpenAPI document.
- `sec-authz.md`, `sec-input.md`: static sub-sweeps with full findings and per-route detail.
- `sec-probes.mjs` / `sec-probes-result.json` and `sec-probes2.mjs` / `sec-probes2-result.json`: dynamic probes and results.
- `rate-par.mjs`: login rate-limit burst.
- `si01-demo.mts`: SEC-02 proof against the `a84ee0b` verifier copy.
- `npm-audit-*.json`.
- `scratch-api/logs/`: scratch API logs grepped for markers.
- `scratch-api-run1.out` / `scratch-api-run2.out`.

These files are outside the repo and are not kept by git. Copy them before the session's scratchpad is cleared if they are needed as audit evidence.
