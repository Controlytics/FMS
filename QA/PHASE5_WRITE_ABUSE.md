# QA Phase 5 — Write-Path Abuse Sweep (real tokens)

Target: production build API `https://localhost:3104`, DB `digilog_qa_perf` (disposable clone).
Date: 2026-10-21. Runner: `QA/tests/phase5/*.mjs`. Raw results: `QA/results/phase5/*.json`.
No SUPER_ADMIN account used (operator set it aside) — every probe is a non-SA role
(OPERATOR, SHIFTOFFICER, SUPERVISOR, QA, MANAGER, ADMIN). Mutations were confined to the clone and
are listed in §7.

## 1. Method

- **One token per role** via the perf accounts (`tests/performance/results/perf-users.json`); a
  **second user per role** for wrong-password probes (max 2 wrong attempts/user, under the 3-attempt
  lockout; counters reset with a fresh login afterwards — verified 0).
- `QA/tests/phase5/lib5.mjs` — a raw HTTPS client that can send arbitrary headers / non-JSON bodies
  (the perf client cannot), plus `sample()` which builds a schema-valid minimal body so a request
  **reaches the preHandler gate** rather than stopping at Fastify validation.
- `snapshot.mjs` — per-table row-count + content hash of all 62 tables + max `audit_trail.chain_position`,
  taken before/after each phase and diffed.
- `pw-search.mjs` — literal search for the shared perf password across every table (text form) before
  and after; clone `logs/app/http` + `logs/app/error` grepped after sending `x-reauth-password`.
- Inventory source: `docs/production-readiness/03_API_ENDPOINT_INVENTORY.md` (224 write ops), diffed
  against the live `/docs/json` (429 ops) — **identical set, 0 drift**, so nothing new was skipped.

## 2. Coverage

| Category | What was probed | Ops / requests |
|---|---|---|
| 1. Authorization | every parseable write op called by every role lacking the gate, + no-token | 224 ops, 1063 role-probes over 205 ops, 218 no-token |
| 2. Re-auth bypass | gated actions: no pw / wrong pw (body + header) / offline-replay grant on + off `/api/filters/*` / grant of another user / forged / legacy header / `_currentPassword` as number/object/empty | 21 gated actions + 24 edge cases |
| 3. Mass assignment | id, createdBy, role, status, isActive, permissions, approvalStatus, approvedBy, submittedBy, passwordHash, username, failedLoginAttempts, authSource, lockoutUntil, forcePasswordChange on user create/update, self-profile, filter create/update — verified in DB | 15 cases, DB-checked |
| 4. IDOR / scope | notification read/unread/delete addressed to another user / to SUPER_ADMIN role | 4 cases, DB-checked |
| 5. Input abuse | 7 body mutators (200 KB string, NUL byte, XSS/SQLi/unicode, wrong type, 1e308, -2^31-1, bad uuid) + 5 path-id abuses (traversal, SQLi, NUL, 5 KB id, non-uuid) + bad JSON / array / text-plain / prototype-pollution, on every write a gate-holding role can reach | 94 ops, 1127 requests |
| 5. SSRF + upload | instrument URL tester vs metadata/loopback/file/gopher/IPv6; photo upload traversal name / wrong magic / text-html / control | 6 + 4 |
| 6. Segregation | stage approval self-approve (single + bulk); admin-request subject = SUPER_ADMIN; MODIFY_USER→SUPER_ADMIN; report-export-log gating | 5 + 4 |

**Not covered:** SUPER_ADMIN-only routes (79 ops — SA set aside); `/api/backup/restore`,
`/api/config/*` destructive writes beyond the re-auth/role checks already probed (not fuzzed, to avoid
rewriting live config); multipart bulk-upload-filters / replacement / pm-schedule **file** parsing
(only JSON bodies and one photo multipart were sent); LDAP/SMTP live connects; filter/PM/replacement
full self-approval SoD (no non-SA role holds both create and review/approve — stated below).

## 3. Findings

Severity: P0 breach/corruption · P1 major · P2 significant · P3 minor. **No authorization, mass-assignment,
IDOR or SoD *escalation* was found** (no role reached a capability it lacks, no privileged field was
persisted). Two P2 integrity/consistency defects, one P3 input-handling gap, and two observations.

| ID | Sev | Title | Repro | Observed | Expected | Source |
|---|---|---|---|---|---|---|
| **P5-01** | **P2** | Generic filter edit erases a **retirement record from the Retirement list**, and lets any FILTER_EDIT role edit a retired/deactivated filter with **no re-auth** | SHIFTOFFICER (FILTER_EDIT, no re-auth on this path) `PUT /api/assets/instances/{retiredId}` `{status:"Active"}` on a Retired, `isActive=false` filter → 200; the filter then **vanishes from `GET /api/filters/retirements`** (verified by `m7-check.mjs`: in list before, gone after, back after restore) | 200; retirement record dropped | A retired filter should not be silently de-listed by a free-text status edit, and editing a deactivated/retired filter should be blocked or re-auth-gated | Retirement list reads `status='Retired' AND isActive=false` (`modules/filter-operations/filter-operations.service.ts:1104`); generic update copies `status` verbatim with no lifecycle/retired guard and no re-auth (`modules/assets/services/instance.service.ts:317`, `modules/assets/routes/instance.routes.ts` PUT — EDIT_FILTER re-auth is only on `SUPERVISOR`, SHIFTOFFICER's update is unsigned). `status` is free text (`updateAssetInstanceSchema.status = z.string().max(50)`, no enum). |
| **P5-02** | **P2** | Offline-replay grant replaces the re-auth password on `/retire` with **no `offlinePerformedAt`/`clientOpId` and no `replayExemptGates` record** | SUPERVISOR mints a grant (`POST /api/auth/offline-grant`), then `POST /api/filters/{id}/retire` `{remarks}` + `x-offline-replay-token` and **no** replay fields → reached the handler (404 on a random id = re-auth gate satisfied by the grant). No password, no 400 OFFLINE_REPLAY_FIELDS_REQUIRED | For a replayed route the grant is accepted only with `offlinePerformedAt`+`clientOpId` and each skipped gate recorded (CLAUDE.md 2026-09-25) | `isOfflineReplayRoute` is a bare `startsWith('/api/filters/')` (`plugins/auth.ts:475`), but `retire()`/`replace()` never call `assertOfflineReplayPayload` (only advance/bypass/start-cycle/submit-checklist/terminate do) — so on retire/replace the grant is a **silent** password substitute. **Live for retire** (SUPERVISOR holds FILTER_RETIRE and RETIRE_FILTER is in its re-auth policy). **Latent for replace** (no non-SA role holds both FILTER_REPLACE and the REPLACE_FILTER re-auth policy today). `bulk-operate` is **not** affected (it dispatches through advance/submit-checklist, which do assert). Not an auth escalation — the grant is still user+session-bound and password-minted — but it defeats the 2026-09-25 invariant that the bypass be visible. Operator decision. |
| P5-03 | P3 | A client NUL byte (`\u0000`) or an out-of-INT4 integer in a write field that reaches a Prisma query returns **500 INTERNAL_ERROR**, instead of 400 | `POST /api/checklist-profiles` `{name:"qa\u0000p5",...}` (SUPERVISOR); `POST /api/user-groups` `{name:"qa\u0000p5"}` (ADMIN); `POST /api/notification-settings/sms/test` NUL recipient; `POST /api/pm-schedules` `{year:-2147483649,...}` (SUPERVISOR) | 500, generic body `Internal server error` (**no leak**); the error handler tries to dispatch a `SYSTEM_ERROR` notification (rate-limited; **none was delivered on the clone** — no rule) | 400 VALIDATION_ERROR | `apps/api/src/app.ts:428` maps `PrismaClientKnownRequestError` (P-codes) and `PrismaClientValidationError`, but **not `PrismaClientUnknownRequestError`** — the NUL byte surfaces as raw Postgres `22021`, the int overflow as a driver conversion error, both wrapped `Unknown` with no `P####` code → generic 500. Same class as D013, one error type short. |
| P5-04 | P3 (obs) | `status` and `photoUrl` are unvalidated free text | SHIFTOFFICER set a filter `status` to `<img src=x onerror=...>` → 200 (stored, cosmetic — `isActive` and lifecycle unchanged; **not** a retirement bypass). OPERATOR `PUT /api/auth/profile` `{photoUrl:"../../../../Windows/win.ini"}` and `{photoUrl:"https://evil.example/x.png"}` → 200, both stored | — | Stored-as-typed (CLAUDE.md). No `unlink` is ever built from `photoUrl` (only `photo-orphan-sweep.ts` deletes generator-named files it owns), so the traversal string cannot delete a file. The external URL would be fetched by the `<img src>` wherever an avatar renders — a minor SSRF/privacy leak on the viewer's browser, and `status` has no enum. Give both a validated shape. |
| P5-05 | P3 (obs) | Public admin-request submit requires a token with a **trailing slash**; a `{}` PUT to a config endpoint replaces the whole object | `POST /api/admin-requests/` (slash, no token) → 401, `POST /api/admin-requests` → 201. `PUT /api/notification-settings/email {}` (ADMIN, signed) → 200 and overwrote the config with `{}` | consistent / merge | `plugins/auth.ts:244` matches exact `/api/admin-requests`; the web client posts without the slash (`contact-admin.tsx:194`), fail-closed, benign. The email/sms config PUT does `configValue: body` (whole-object replace after masked-secret preservation) — an empty or partial body wipes the rest; restored from backup. |

### What was verified SAFE (no defect)

- **Authorization (cat 1):** 0 FAIL across 1063 role-probes + 218 no-token probes. Every write called
  by a role lacking the gate returned 403 (or 401 without a token), or 400 when schema validation ran
  first (6 INCONCLUSIVE on `/api/report-reviews` only — all 400, never reached the handler). No 2xx.
- **Re-auth (cat 2):** every gated action refused no-password, wrong-password (body and
  `x-reauth-password` header), and a valid offline-replay grant on non-`/api/filters/*` routes
  (401 REAUTH_REQUIRED). `_currentPassword` as `""`, a number, or `{$ne:null}` → all 401, never a
  NoSQL-style bypass. Offline-replay grant on a `/api/filters/*` route **requires**
  `offlinePerformedAt` + `clientOpId` (400 `OFFLINE_REPLAY_FIELDS_REQUIRED`); a grant bound to another
  user → 401 `OFFLINE_REPLAY_TOKEN_USER_MISMATCH`; a forged grant → 401 `OFFLINE_REPLAY_TOKEN_INVALID`;
  legacy `x-offline-replay: true` → 401 deprecated. `_currentPassword` never persisted: literal
  password search over all 62 tables = **0 hits** before and after; not found in clone http/error logs.
- **Mass assignment (cat 3):** `role`/`status`/`permissions`/`passwordHash`/`username`/`isActive`/
  `failedLoginAttempts`/`authSource`/`createdBy`/`id` on self-profile and on ADMIN→user update were
  **all ignored** — DB rows byte-identical before/after (AJV strips unknown props; the service copies a
  fixed field list). ADMIN→role=SUPER_ADMIN → 403 (hierarchy). ADMIN acting on the SUPER_ADMIN account
  (update/disable/reset/unlock) → 403 on all four, SA row unchanged. ADMIN create SUPER_ADMIN → blocked
  (user-id numeric rule, then hierarchy). Filter create with `approvalStatus:APPROVED`/`approvedBy`/
  `id`/`createdBy` extras → the row came out `PENDING_REVIEW`, `created_by`=the real caller, forced id
  ignored (server-generated).
- **IDOR (cat 4):** OPERATOR mark-read/unread on a notification addressed to another user → 404 (not
  visible, not acted on); ADMIN on a SUPER_ADMIN-role notification → 404; OPERATOR delete → 403.
- **SSRF (cat 5):** instrument URL tester blocked `169.254.169.254` (metadata), `localhost`/`127.0.0.1`/
  `[::1]` (loopback), `file://` and `gopher://` (scheme) — each a clean `{ok:false}`, no fetch.
- **Upload (cat 5):** magic-byte check rejects a text body declared `image/png` and `text/html`; only a
  real PNG header passes; generated filename is `${userId}-${uuid}` so the traversal filename is
  discarded.
- **Segregation (cat 6):** stage self-approval refused `SELF_APPROVAL_FORBIDDEN` on both the single and
  the **bulk** path (bulk returns 200 with a per-item failure, not a silent pass); a different
  SHIFTOFFICER then approved; a second approval of the decided row → 400. `report-export-log` honours
  per-report read gates (OPERATOR blocked on Audit Trail, allowed on the reports its perms cover).
  admin-request FORGOT_PASSWORD / MODIFY_USER targeting a SUPER_ADMIN → refused (hierarchy / "cannot be
  requested here"); SA password hash unchanged.
- **report-reviews (cat 1):** with a schema-valid body (`reportType`+`title`+`dataSnapshot`), submit →
  403 for all six roles (none holds REPORT_REVIEW_SUBMIT), approve → 403 for all (none holds
  REPORT_APPROVE); review bodies 400 at validation. No bypass.
- **Input abuse (cat 5), beyond P5-03:** across 1127 fuzzed requests, status histogram
  `{200:63, 201:9, 400:710, 403:2, 404:278, 406:4, 409:6, 413:1, 414:50, 500:4}` — the only 5xx are the
  4 in P5-03, and **no response leaked** a Prisma message, stack frame, file path or SQL (leak scan over
  every body = 0). Path traversal / SQLi / NUL / 5 KB ids all → 400/404/414. Prototype-pollution bodies
  → 400, no `polluted`/`isAdmin` effect. 200 KB strings → 400 VALUE_TOO_LONG or 413.
  **Coverage caveat:** for write ops whose schema has no `required` field, `sample()` returns `{}`, so
  every body mutator for those ops sent an empty `{}` (not true fuzzing) — notably the
  `/api/notification-settings/{email,sms}` PUTs (whose 200s are empty-body sends, see P5-05). Those ops
  are body-schema-present but not value-fuzzed; their path-id and raw-JSON variants still ran.

### Not reachable with non-SA roles (stated, not a pass/fail)

Filter approval, PM-schedule approval and replacement-schedule approval self-approval could not be
exercised end-to-end: **no non-SA role holds both the create/submit and the review/approve permission**
for any of them (QA holds FILTER_APPROVE + PM_APPROVE but not the create perms; MANAGER holds review
not approve; etc.). D010's `assertNotOwnFilter` is covered in-process by
`assets/__tests__/filter-approval-sod.test.ts`. The one same-person path a single role CAN reach —
stage approval — is enforced (above).

## 4. Honest counts

- Authorization probes: **1063** role-calls + **218** no-token — **0 HIGH (2xx) findings**.
- Re-auth: **45** probes — **0 password bypasses** (P5-02 is a grant on retire with the bypass
  *unrecorded*, not a passwordless entry for a role without the grant).
- Mass-assignment: **15** DB-verified — **0 privileged field persisted**.
- Input abuse: **1127** requests — **4 × 500** (P5-03), **0 leaks**, 0 corruption.
- New defects: **2 × P2** (P5-01 retirement-list erasure + unsigned edit of a retired filter;
  P5-02 unrecorded grant bypass on retire), **1 × P3** (P5-03), **2 observations** (P5-04, P5-05).

Prior defects, honest re-check this phase:
- **D011** (ADMIN saving SA-only config) — held: ADMIN config PUTs 403'd in the authz sweep.
- **D015** (notification visibility) — held: foreign/SA-addressed notification read/unread → 404.
- **D013** (Prisma mapping) — **partially** held: P2025→404 and PrismaClientValidationError→400 work,
  but `PrismaClientUnknownRequestError` still 500s — that gap is P5-03.
- **D006** (unsigned config-page writes) — not reachable here: the CONFIG_UPDATE role gate fires before
  re-auth for non-SA roles, so a non-holder gets 403 not an unsigned 200; the signed path is covered.
- **D005** (block-change notification enum), **D010/D012** (filter-approval SoD / FDM validation),
  **D022** (FDM re-auth) — **not covered**: all SUPER_ADMIN-only or needing a role no perf account has
  both halves of. Stated as not covered, not as passes.

## 5. Mutations made on `digilog_qa_perf` (for cleanup)

All confined to the clone. Snapshots `base → final` (`snapshot.mjs`): admin_requests +4,
asset_instances/filters/filter_details +1 (the test filter), asset_relationships +2,
checklist_profiles +5, cleaning_stage_approvals +1 (SoD probe), filter_events +2 (both on filter
`1c48b9c6`, from the SoD advance), notification_logs +8, notification_templates +1, notifications +6,
pm_schedules +1, user_groups +3, audit_trail +352 rows (every write is audited; max chain_position
57374 → 57726 — **chain NOT re-verified this phase** — memory notes the chain was already not intact,
so re-measure before quoting). Rows restored by me: `users.photo_url` for perf_user_001 (→ null),
`system_config` `notification-email`/`notification-sms` (value + attribution restored from
`QA/results/phase5/system_config-backup.csv`). No user row's role/status/password was changed.

**State change the clone reset must undo:** the SoD probe advanced real in-progress cycle on filter
`1c48b9c6-bacb-4e68-b696-1cdca83895b8` from WASH_IN → WASH_OUT and had it approved by perf_user_222.
On-disk: one uploaded avatar `apps/api/.../uploads/photos/833294d8-7e79-4d54-85c5-ddfcba69af04-210bd178-c5fe-4c82-…png` (the PNG-magic control; `photo_url` no longer points at it, so the nightly orphan sweep removes it).

Rows to delete when resetting the clone:

```
checklist_profiles: c4f61c96-01ee-4088-8043-359c88d42a94, c46a21b2-8727-4902-955d-b91b70a375a2,
                    ae347da3-582c-4c0a-b16c-e113c6fc5156, c7e5fa4b-0476-4597-9046-6d76de147518,
                    ea4c2f5e-c0b7-48da-99bd-4fdeaa77c06a
user_groups:        fa8241ec-… (<script> name), cce22455-… (12345), a5933e3f-… (qa-p5-probe)
pm_schedules:       2f1d2ac1-e2f5-46e3-8d63-29f302526c5b  (entity_id is a random uuid — orphan)
admin_requests:     6b505600-…, 6ac83515-…, 44a27464-… (CREATE_USER), be7064ac-… (FORGOT_PASSWORD, superadmin) + 1 more FORGOT_PASSWORD from scope-probes2
notification_templates: 039afb34-ab79-45b9-ab86-03bb07d8161f
asset_instances/filters/filter_details: f1e82ef3-2eb4-44a7-aa36-781d14a53775 (QAP5-MA-FILTER-1) + its 2 relationships (no filter_events)
notification_logs: 8 rows (EMAIL/SMS FAILED test sends)
notifications: 6 rows (USER_CREATION_REQUEST_SUBMITTED ×3, STAGE_APPROVAL_REQUESTED, _APPROVED from the SoD advance, + 1)
cleaning_stage_approvals: 1 row on filter 1c48b9c6-… (Wash Out, approved by perf_user_222 in the SoD probe)
filter_events: 2 rows on filter 1c48b9c6-… (WASH_OUT transition + approval)
```

Audit rows are immutable by design and are left in place (deleting them would break the chain); they
are the record that these probes ran.

## 6. Scripts

`QA/tests/phase5/`: `lib5.mjs` (client + schema sampler), `whoami.mjs`, `authz-sweep.mjs`,
`reauth.mjs`, `reauth2.mjs`, `mass-assign.mjs`, `m7-check.mjs`, `input-fuzz.mjs`, `sod-stage.mjs`,
`scope-probes.mjs`, `scope-probes2.mjs`, `export-log.mjs`, `snapshot.mjs`, `pw-search.mjs`,
`reset-fails.mjs`.
