# Enterprise Audit — High findings triage (2026-07-15)

Source: `wf_6ea8254c-3b2` (2026-07-13), 38 Highs. Findings were UNVERIFIED.
This pass adversarially verified 24 of them against HEAD `26ad7d4` (branch RFID),
refute-by-default, 4 parallel agents. Detail file:
`AppData/Local/Temp/claude/.../d4e93b4a-.../scratchpad/audit/high-detail.txt`.

## Bucket 0 — ALREADY FIXED (verified present at HEAD, drop)

| # | Finding | Evidence |
|---|---------|----------|
| L56 | fastify CVE GHSA-247c | `apps/api/package.json` → `^5.10.0` |
| L66 | xlsx prototype-pollution/ReDoS | removed from `apps/web`; `exceljs ^4.4.0` |
| L156 | roles self-escalation | `assertRoleWithinCallerPrivilege` in `role.service.ts:23` |
| L196 | users update/disable no target guard | `assertCanManageTarget` at `user.service.ts:24`, 6 call sites |
| Critical | LDAP sentinel bypass | `auth.service.ts:169` now `&& !skipPasswordCheck` |
| **L81** | **admin-requests "second door"** | **REFUTED at HEAD** — `admin-request.service.ts` calls the *guarded* `userService.create/update/unlock/resetPassword` (L166/186/196/210). The 07-13 `assertCanManageTarget` fix closed it transitively. Residual: `ADMIN_REQUEST_APPROVE` holder can act at-or-below own hierarchy without USER_* perms — SoD gap, no escalation, arguably intended. NOT a High. |

Also note: `sanitize-html` (L61) still at 2.17.2 — needs separate advisory check.

## Bucket 1 — DESIGN COLLISION (do NOT fix without user's explicit call)

| # | Finding | Why it's blocked |
|---|---------|------------------|
| L181 | super-admin PUT replacements rewrites checksummed audit fields | This is very likely the **manual-record-edit feature the user authorized**, overriding the §11 warning twice (see `project_manual_record_create_2026_07_10`). "Fixing" reverts a deliberate feature. |
| L176 | Reauth on Filter Data mutations ships OFF | User has repeatedly chosen reauth as configurable/off-by-default. Likely intentional. Compounds with L21 (`SUPER_ADMIN_DATA_EDIT` is also *unsettable* in the UI) — that half IS a real bug. |
| L186 | sync version cursor = global max over per-row counters | **offline-sync is a protected surface** (`feedback_offline_sync_protected_surface`). Never touch in a sweep. Own task, user-directed only. |

## Bucket 2 — CONFIRMED, safe to fix (frontend)

| # | Finding | Verdict | Notes |
|---|---------|---------|-------|
| L26 | Edit Filter dialog flips Set B → Set A | CONFIRMED | **Highest value.** `filter-list.tsx:951` seeds `f.filterSet === 'B'` but wire value is `SET_B` → always 'A'; `:974` always sends it → `filter.service.ts:101` upserts `SET_A`. Silent data corruption on *every* edit of *every* Set B filter; audit row reads as intentional. Needs a data audit of existing `filter_details`. |
| L36 | Editing LOCKED/EXPIRED user silently fails | CONFIRMED (empirically, via real RHF in jsdom) | `updateUserSchema.status` is `ENABLED\|DISABLED` only; DB enum has LOCKED/EXPIRED. Resolver rejects → no request, no error rendered. Fix: drop `status` from `edit.tsx:78` `values`. |
| L11 | Lazy routes without Suspense | CONFIRMED | `/audit`, `/report-reviews`, `/stage-approvals` (main.tsx:265-267). Only repros on cold chunk (hard refresh/deep-link). |
| L16 | Inline components → focus loss per keystroke | CONFIRMED | 5 components declared inside `RoleAssignmentsPage` (role-assignments.tsx:151/171/179/206/241). Multi-digit values unenterable. |
| L46 | Unlock failures silently swallowed | CONFIRMED | `list.tsx:210` is the only one of 3 `reauth.execute` sites passing no `onError`. Admin hands out a temp password for a still-locked account. |
| L41 | Role dropdown blank for USER_UPDATE-only editors | CONFIRMED (partial) | Premise real (`/creatable` is USER_CREATE-gated → 403 → 0 options). **Claimed "silent save no-op" REFUTED** — RHF submits from `_formValues`, not the DOM; role is preserved. Lower severity: cosmetically broken form. |
| L21 | 3 reauth actions invisible in both editors | CONFIRMED | `REAUTH_ACTION_CATEGORIES` has 13; 15 in use. Missing `'Notifications'` + `'Super Admin'`. **Requires `npm run build -w @digilog/shared`.** TS will flag CATEGORY_META gaps as compile errors. |

## Bucket 3 — CONFIRMED, safe to fix (backend, non-compliance)

| # | Finding | Verdict | Notes |
|---|---------|---------|-------|
| L191 | `users.list ?role=SUPER_ADMIN` bypass | CONFIRMED (lead-verified) | `user.service.ts:52` — `where.role = query.role ? query.role : { notIn: excludedRoles }`. Supplying `?role=` **replaces** the exclusion. Fix: intersect, don't override. Note the 07-13 SA-hiding work covered the *roles* endpoints, not this one. |
| L106 | block-change mass assignment → self-forge APPROVED | CONFIRMED | `block-change.service.ts:36` spreads `...data` from `req.body`; POST schema lacks `additionalProperties:false`; no AJV override exists (checked app.ts:100-104). A `BLOCK_CHANGE_REQUEST` holder POSTs `status:'APPROVED'` → `hasApproval()` true → cross-block gate bypassed with no approver. Fix: explicit named fields, never spread. |
| L141 | ADMIN never sees own/general notifications | CONFIRMED (empirically — captured generated SQL) | `NOT: { forRole: 'SUPER_ADMIN' }` ANDed at top level; `NOT (NULL = 'SUPER_ADMIN')` → NULL → row excluded. Kills 2 of 3 OR branches. **Two sites**: `notification.service.ts:64` + `notification.repository.ts:125` (docstring promises byte-for-byte mirror — it mirrors the bug). |
| L86 | audit bulk redact/delete 500 over 6 records | CONFIRMED (threshold = 7) | `targetId` is `VarChar(255)`; `matchedIds.join(',')` = 37n−1 → n=7 is 258 > 255. PG raises 22001 (no cast → no silent truncation); inside `$transaction` → full rollback. Fix: `targetId: null`, list already in JSONB `beforeValue.records`. |
| L121 | interlock stripped from current-state | CONFIRMED — **severity reframed** | Route HAS a 200 schema (routes.ts:150-229); `interlock` + `stageLookup[].interlockGated` undeclared → fast-json-stringify drops them. Online is display-only (actions[] still enforces), but **offline breaks enforcement**: `mobile-operations.tsx:1555` `!!undefined === false` → operator advances out of an interlock stage with no QA approval. |
| L126 | LDAP TLS verification off by default | CONFIRMED | `ldap.service.ts:73` `tlsRejectUnauthorized: false` + `?? false` at 3 bind sites. MITM leaks bind + every user password. |
| L131 | LDAP roleMappings unvalidated + substring match | CONFIRMED at **reduced severity** | **SUPER_ADMIN takeover REFUTED** (3 guards: auth.service.ts:140/169 + hierarchy guard). Real ceiling is ADMIN. Confirmed: no allow-list on save, no validation on assign (`ldap.service.ts:238`), `.includes()` substring match (`:237`) — `admin` matches `CN=BackupAdmins`. |

## Bucket 4 — CONFIRMED but COMPLIANCE-SENSITIVE (checkpoint before fixing)

| # | Finding | Verdict | Notes |
|---|---------|---------|-------|
| L136 | Email/SMS secrets PLAINTEXT into hash-chained audit trail | CONFIRMED | `notification-delivery/routes.ts:110` masks only `password`; `clientSecret`/`refreshToken`/`accessToken` spread through. **Aggravated**: L85-100 rehydrates the *real* secrets into `body` right before the audit call, so the admin cannot avoid it. Same class at `:434` (`httpGatewayHeaders` bearer tokens). **Existing rows cannot be scrubbed without breaking the chain** — needs a decision. |
| L116 | checklist-profiles: only `create` is audited | CONFIRMED | update/delete/question mutations write nothing to `audit_trail`. Mitigation: version sidecar exists — but it's not hash-chained, not immutable, not in the inspector UI, and `delete()` cascades it away. §11.10(e). Gotcha: call `auditLog` AFTER tx commit; register new actions in `audit-actions.ts`/`audit-templates.ts`. |
| L91 | Backup export leaks bcrypt hashes in `password_history` | CONFIRMED | `stripSensitiveColumns` guards `if (table !== 'users') return rows` — `password_history` is a *different table* (not the `users.password_history_hashes` column it does strip, and not the 07-04 sentinel fix). Pair fix with a restore-side snapshot or sentinels overwrite real history. |
| L96 | Restore doesn't disable asset/filter mirror triggers | CONFIRMED | Only `audit_trail` triggers are disabled (`backup.repository.ts:351`); `session_replication_role` used nowhere. `topologicalSort` emits `asset_instances` before `ahus`/`filters` → mirror pre-populates → plain INSERT → duplicate-key → full rollback. **Fails on any real dataset.** |
| L101 | Restore never resyncs manual sequences | CONFIRMED | `resetAuditSequence()` is a **no-op with a stale comment** and **zero callers**; TRUNCATE has no RESTART IDENTITY. Breaks: deviation_number unique violation, and `chain_position` collisions → **hash-chain verification permanently broken**. |
| L146 | PM PUT archives ACTIVE before validating | CONFIRMED | `pm-schedule-crud.ts:86` archives outside any tx; validation IIFE at :100 throws after. Empty body `{}` → schedule ARCHIVED with no ACTIVE replacement → PM generation stops silently. The `entries !== undefined` guard is inert (arg is `data.entries ?? []`). |
| L151 | PM bulk upload destroys APPROVED + PmExecution before approval | CONFIRMED | `pm-import.ts:144-148`, no `$transaction`. Replacements land in `PENDING_REVIEW` — may never be approved. Execution history irrecoverable. **Large effort**; hard-replace may be relied-upon semantics. |
| L161 | super-admin DELETE replacements can never succeed | CONFIRMED | `routes.ts:344` bare `prisma.auditTrail.delete` vs live `audit_trail_no_delete` trigger; no Prisma error mapping in app.ts → raw 500. Feature is 100% dead. Does NOT use the working machinery at `audit/routes.ts:613-618`. |
| L166 | super-admin DELETE retirements 500s | CONFIRMED | `routes.ts:176` bare `deleteMany` on audit rows. Fails *precisely because* retire always writes FILTER_RETIRED. |
| L171 | super-admin unretire non-transactional, 500s mid-way | CONFIRMED | ~10 sequential destructive writes, no `$transaction`; two `.catch(() => null)` swallows; uncaught `deleteMany` at :286 raises. **Half-applied destruction that cannot roll back** — relationships/identifiers/events/cycles hard-deleted, then 500. |
| L111 | block-change approvals never consumed / never expire | CONFIRMED | `consumeApproval`/`hasApprovalTx`/`consumeApprovalTx` have **zero callers**. `autoExpireHours` is config theater (editable, read by nothing). A comment documents a 2026-05-05 fix that was written and never wired. **Semantics decision needed**: single-use vs durable. |

### Cross-cutting note (from the backup agent)
L96 and L101 **compound**. L96 makes restore fail loudly on any real dataset — which implies **the restore path has never been exercised against production-shaped data**. That explains why L101 went unnoticed, and means fixing L96 alone will *unmask* L101. Fix together; validate with export → fresh-DB restore → `GET /api/audit/verify-chain` → create-a-deviation round trip.

## Baselines to hold
- api: 876/0/13 (single-fork: `cd apps/api && npm test`)
- web: 373/0
- FE changes need `npx vite build` to be live; `packages/shared` changes need `npm run build -w @digilog/shared`.
