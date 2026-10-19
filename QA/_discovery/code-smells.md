# Code-smell and unfinished-code sweep — QA discovery

Read-only sweep of `apps/api`, `apps/web`, `packages/shared`, `scripts`, `rfid_scan_app` on branch `RFID`, 2026-10-19.
Every count below comes from a grep/perl scan listed in the footnote. Nothing was executed (no vitest, tsc, eslint, node).
Excluded: `node_modules`, `dist`, `build`, `.playwright-mcp`, `old/`, `tests/performance/results`, coverage, `logs*`, `generate-sample-logs.ts` (fabricated sample data).
Test files appear only in category 7.

Severity is a guess for QA triage: P0 = data loss / compliance break, P1 = wrong result reachable by a normal user, P2 = defect under a plausible condition, P3 = hygiene.

## Summary counts

| # | Category | Hits | Of which likely real defects |
|---|---|---|---|
| 1 | TODO / not-implemented / placeholder markers (non-test) | 7 | 2 |
| 2 | Swallowed exceptions (empty catch 16, `.catch` no-op 26, console-only catch 11) | 53 | 9 |
| 3 | Error-handling inconsistencies in `apps/api` | 10 | 4 |
| 4 | Mutating routes without a usable body schema (of 206) | 62 flagged, 20 genuinely unvalidated | 20 |
| 5 | Hard-coded values (suspicious only; "fine" listed separately) | 11 suspicious / 14 fine | 4 |
| 6 | Frontend dead/placeholder controls, native dialogs, lint suppressions, `as any` in auth code | 1 + 20 + 32 + 25 | 3 |
| 7 | Test smells | 12 `it.skip`, 1 `describe.skipIf`, 12 cleanup `.catch(() => {})`, 0 sleeps, 0 commented asserts | 1 |
| 8 | Security-adjacent (35 `*RawUnsafe`, 2 `child_process`, 4 `Math.random`, JWT) | 44 | 3 |
| 9 | Read-then-write without transaction or unique key | 17 candidates, 2 real races | 2 |

---

## 1. TODO / FIXME / not implemented / placeholder

Grep over `apps packages scripts rfid_scan_app` for `TODO|FIXME|XXX|HACK|not implemented|coming soon|placeholder` (non-test). Only 5 TODO-class comments exist in the whole TS codebase; the `placeholder` hits are almost all legitimate UI `placeholder=` props or audit-template placeholder names and are not listed. No TODOs in Kotlin, Java, PowerShell or batch files.

| ID | file:line | snippet | why it matters | Sev |
|---|---|---|---|---|
| CS-001 | apps/api/src/modules/dashboards/routes.ts:533 | `return { widgetId, widgetType: widget.widgetType, data: [], message: 'Widget type data fetch not implemented' };` | Unimplemented widget types answer **200** with a message string. Schema at :252 accepts 9 widget types incl. `scada_symbol`, `map`, `html_widget`, `image`; the web has no renderer for `html_widget`/`innerHTML` (0 grep hits) so a stored widget renders nothing. | P2 |
| CS-002 | apps/api/src/modules/notification-delivery/delivery.service.ts:97 | `* TODO: Replace setTimeout retries with a durable delayed-retry mechanism` | Retry = in-process `setTimeout` (5s/15s/45s, :24). A service restart or crash between attempts loses the retry and the `notificationLog` row stays `PENDING`/`RETRYING` forever. QA: kill API mid-retry, check log status. | P2 |
| CS-003 | apps/api/src/modules/notification-delivery/notification-dispatcher.ts:22 | `// TODO: Move cooldown tracking to Redis for cross-instance consistency` | Stale (Redis retired 2026-05-01). Cooldown `Map` is in-memory: every restart resets rule cooldowns, so a rule can fire twice inside its cooldown window across a restart. | P3 |
| CS-004 | apps/web/src/routes/filter-management/ahu-dashboard.tsx:90 | `<button disabled className="…cursor-not-allowed…" title="Coming soon">Swap Sets</button>` | Visible dead control shipped to users; the only literal-`disabled` button in the SPA. | P3 |
| CS-005 | apps/api/src/modules/config/static-routes/action-reauth.routes.ts:9 | `// Extracted from the main config/routes.ts monolith — see TODO in that file` | Dangling reference: `config/routes.ts` contains no TODO (grep). Harmless but misleading. | P3 |
| CS-006 | packages/shared/src/pipeline-executor/context.ts:102,114 | `THIS exported stub is a typed placeholder so …` | Exported stubs for the Prisma-side and IDB-side context. Needs review that nothing imports the stub at runtime expecting behaviour. | P3 needs review |
| CS-007 | apps/api/src/modules/ldap/ldap.service.ts:124 | `// If bindPassword is masked placeholder, keep existing` | Masked-secret round-trip convention (`••••••••`). Same convention in dynamic-routes.ts:126. Fine, but QA should confirm a literal 8-bullet password cannot be set. | P3 needs review |

---

## 2. Swallowed exceptions

Totals (non-test, `apps/api/src` + `apps/web/src` + `packages/shared/src`): 544 `catch` sites; 16 empty/comment-only `catch {}` blocks; 26 `.catch(() => {})` / `.catch(() => null)` lines; 11 catch blocks whose first statement is `console.*`.
Items in `apps/web/src/lib/sync-engine.ts`, `offline-store.ts`, `offline-cache.ts` and `main.tsx:154` are the **protected offline surface — report only, do not change.**

### 2a. Empty / comment-only catch blocks (16)

| ID | file:line | snippet | what failure is hidden | Sev |
|---|---|---|---|---|
| CS-010 | apps/web/src/routes/config/equipment-groups.tsx:176 | `} catch { // swallow — proceed straight to the editor }` | The "are there IN_PROGRESS cycles using this group?" guard (:168) is skipped on any API error, so an edit proceeds against a group with live cycles. Cycles pin `profile_id` not group, so impact is on instrument identity in later readings. | P2 |
| CS-011 | apps/web/src/routes/mobile/mobile-login.tsx:123 | `try { await fetch(\`${getApiBase()}/api/auth/logout\`, …) } catch {}` | If the discard-logout fails after a tablet-access refusal, the server session stays alive while the client drops the token; the user's next WEB login hits SESSION_CONFLICT. Partly superseded by the 2026-10-13 login-time check (CLAUDE.md), but the path is still live as a fallback. | P2 |
| CS-012 | apps/web/src/routes/mobile/mobile-login.tsx:163 | same as CS-011 (second copy) | same | P2 |
| CS-013 | apps/web/src/hooks/use-auth.ts:148 | `} catch { // ignore }` around `POST /api/auth/logout` | Logout request failure ignored; token cleared client-side only, server session persists until sweep. Expected offline, but also hides a 5xx. | P3 |
| CS-014 | apps/web/src/lib/pm-pending-cache.ts:45 | `} catch { // Offline, or the user lacks PM_READ. Keep whatever we had. }` | A 403 (role lost PM_READ) is indistinguishable from offline; the missed-PM question is then answered from a stale mirror indefinitely. CLAUDE.md documents staleness as "bounded in the safe direction". | P3 needs review |
| CS-015 | apps/web/src/routes/config/backup.tsx:172 | `} catch { // Non-JSON body … }` | Fine — falls back to status line. | fine |
| CS-016 | apps/api/src/lib/logger.ts:172 | `} catch { // A failing log file must never take down a request. }` | Fine — stdout keeps the line. | fine |
| CS-017 | apps/api/src/modules/auth/auth.service.ts:367 | `} catch { // Token invalid/expired — session is already dead }` | Fine. | fine |
| CS-018 | apps/api/src/modules/backup/backup.service.ts:95 | `} catch { // Cell looks JSON-shaped but isn't valid JSON — treat as a plain string }` | Fine, intentional CSV tolerance. | fine |
| CS-019 | apps/api/src/modules/backup/pg-tools.ts:78 | `} catch { // Not in this directory — keep looking }` | Fine. | fine |
| CS-020 | apps/web/src/hooks/use-android-back-button.ts:48 | `} catch { // Plugin not available (plain web build) }` | Fine. | fine |
| CS-021 | apps/web/src/hooks/use-single-tab.ts:66 | `} catch { // Invalid data, ignore }` | Fine. | fine |
| CS-022 | apps/web/src/lib/connectivity.ts:104 | `} catch { // Plugin not available (web build) — fall back to navigator.onLine }` | Fine (protected surface). | fine |
| CS-023 | apps/web/src/lib/server-contact.ts:36 | `} catch { // localStorage may be unavailable … }` | Fine. | fine |
| CS-024 | apps/web/src/routes/mobile/mobile-operations.tsx:358 | `if (cancelled) { try { off(); } catch {} } else unsub = off;` | Unsubscribe cleanup; fine. | fine |
| CS-025 | apps/web/src/routes/mobile/mobile-operations.tsx:360 | `return () => { cancelled = true; try { unsub?.(); } catch {} };` | Fine. | fine |

### 2b. `.catch(() => {})` / `.catch(() => null)` (26 lines)

| ID | file:line | snippet | what failure is hidden | Sev |
|---|---|---|---|---|
| CS-030 | apps/web/src/routes/auth/contact-admin.tsx:102 | `fetch(apiUrl('/api/roles/active')).then(…).catch(() => {});` | Public Contact-Admin form: if the roles fetch fails the role dropdown is silently empty and a CREATE_USER request cannot name a role. No message to the user. | P2 |
| CS-031 | apps/web/src/routes/filter-management/filter-operations.tsx:1617 | `let termState: any = await getCache<any>(\`filter-state-${filterIds[0]}\`).catch(() => null);` | IDB read failure ⇒ `null` state ⇒ offline terminate/bypass path proceeds as if there is no cached cycle. Same pattern at :1638, :1661. | P2 needs review |
| CS-032 | apps/web/src/routes/mobile/mobile-operations.tsx:3122 | `termState = await getCache<any>(…).catch(() => null);` | Tablet twin of CS-031; also :3144, :3169, :3290 (`cachedState` per batch item). An IDB exception becomes "no active cycle" — the same symptom CLAUDE.md warns about for refused starts. | P2 needs review |
| CS-033 | apps/web/src/main.tsx:154 | `import('./lib/sync-engine').then(m => m.syncPendingOperations()).catch(() => {});` | Boot-time drain failure invisible. **Protected surface, report only.** | protected |
| CS-034 | apps/web/src/routes/filter-management/components/cleaning-reason-dialog.tsx:34 | `getCachedData<any[]>('cleaning-reasons').then(…).catch(() => {});` | Offline reasons list silently empty. | P3 |
| CS-035 | apps/web/src/routes/filter-management/components/drying-filters-panel.tsx:322-324 | `getCache<number>(\`dryer-temp-${filterId}\`)…catch(() => {})` ×3 | Offline dryer temp / state / equipment-groups fallback lost silently. | P3 |
| CS-036 | apps/web/src/routes/filter-management/hooks/use-filter-operations-offline-cache.ts:258-261, 277-280 | `getCachedBlocks().then(setOfflineBlocks).catch(() => {})` ×8 | Offline hierarchy lists silently empty; no "cache unavailable" state. | P3 |
| CS-037 | apps/web/src/components/hard-cutoff-blocker.tsx:68 | `…apiClient.get('/api/health')).catch(() => {});` | Probe only; fine. | fine |
| CS-038 | apps/web/src/routes/pm-schedules/index.tsx:370 | `const body = await res.json().catch(() => null);` | Handled on next line; fine. | fine |
| CS-039 | apps/api/src/modules/backup/backup.service.ts:700 | `if (!preserveDir) await rm(dir, { recursive: true, force: true }).catch(() => {});` | Temp dir leak on failed cleanup; disk only. | P3 |

### 2c. Catch blocks that only `console.*` and continue (11)

| ID | file:line | snippet | what failure is hidden | Sev |
|---|---|---|---|---|
| CS-040 | apps/web/src/lib/filter-ops/use-core.ts:387 | `console.error('[filter-ops] onBeforeDeferredChecklist failed; proceeding', e);` | The pre-checklist hook (missed-PM question / dryer prompt feeders) fails and the checklist submit **proceeds anyway**. QA: force the hook to throw and confirm the server 409 is still shown. | P2 |
| CS-041 | apps/web/src/lib/filter-ops/ahu-completion-check.ts:104 | `console.error('[ahu-completion] batch completion-status check failed', e);` | Batch AHU-completion readiness check failure is logged only; caller behaviour on `undefined` result needs review (may skip the interlock warning). | P2 needs review |
| CS-042 | apps/web/src/routes/mobile/mobile-login.tsx:100 | `console.error('[mobile-login] Failed to mint offline-replay grant after retry — offline mode will fail until next login:', e2);` | User is logged in with NO offline grant and is not told; first offline sync later fails with REAUTH/grant errors. | P2 |
| CS-043 | apps/web/src/routes/mobile/mobile-operations.tsx:2578 | `console.warn(\`[batch-dryer-start] ${rest.filterName} failed:\`, batchErr);` | Per-item failure inside a batch dryer start; verify the item is reported in the batch result UI, not just the console. | P2 needs review |
| CS-044 | apps/web/src/routes/mobile/mobile-operations.tsx:3002 | `console.warn(\`[batch-cycle-start] ${rest.filterName} failed:\`, batchErr);` | Same as CS-043 for batch cycle start. | P2 needs review |
| CS-045 | apps/web/src/routes/config/user-id.tsx:98 | `console.error('Failed to save:', err);` | Followed by `setSaveMessage` at :100, so the user does see a message; fine. | fine |
| CS-046 | apps/web/src/hooks/use-auth.ts:115 | `console.warn('[auth] Offline-replay grant first attempt failed; retrying once:', e);` | Retry follows; fine. | fine |
| CS-047 | apps/web/src/routes/mobile/mobile-login.tsx:94 | same as CS-046 | fine | fine |
| CS-048 | apps/web/src/routes/filter-management/components/drying-filters-panel.tsx:188 | `console.warn('[drying-panel] cache update failed —', …)` | Offline cache write failure; panel still works online. | P3 |
| CS-049 | apps/web/src/routes/filter-management/hooks/use-filter-operations-offline-cache.ts:61 | `console.warn(` (cache refresh) | Offline cache refresh failure; stale cache used silently. | P3 |
| CS-050 | apps/web/src/lib/sync-engine.ts:614 | `console.warn(` (tape-version update) | **Protected surface, report only.** The 20 `catch` sites in sync-engine.ts each carry a rationale comment (:205, :255, :266, :288, :302, :333, :344, :389, :399, :444, :464, :612, :624, :630, :777, :782, :786, :827, :866). | protected |

---

## 3. Error-handling inconsistencies in `apps/api`

Global handler (`app.ts:297-420`) maps `AppError`, `OfflineTimeError`, 429, 413, validation, Zod, 415, JSON-parse, P2002→409, P2000→400, P2024/P2028→503, other Prisma→generic 400, else 500 with no Prisma text. Non-`AppError` messages reach clients only through the handlers below.
`throw new Error(` in non-test `apps/api/src`: 21 total, 6 inside `modules/` (4 email-channel OAuth, 2 backup.repository).
`{ success: false }` returned: 24 lines, 23 of them channel result objects in `notification-delivery/*` + `ldap.service.ts` (a result-type convention, fine); 1 is a route.

| ID | file:line | snippet | why it matters | Sev |
|---|---|---|---|---|
| CS-060 | apps/api/src/modules/notification-rules/routes.ts:379 | `} catch (err: any) { return { success: false, error: err.message }; }` | `POST /:id/test` answers **200** on failure and forwards a raw library/Prisma message. Frontend shows it via `alert(result.error)` (CS-091). | P2 |
| CS-061 | apps/api/src/lib/typed-asset-dispatch.ts:75,198 | `if (!tpl) throw new Error(\`Template not found: ${templateId}\`);` / `throw new Error(\`Asset instance not found: ${id}\`)` | Plain `Error` in a request path (called from `assets/repositories/instance.repository.ts:13`) ⇒ **500 INTERNAL_ERROR** + SYSTEM_ERROR notification for what is a 404. | P2 |
| CS-062 | apps/api/src/lib/ssrf.ts:93 | `if (!check.ok) throw new Error(\`Blocked outbound request: ${check.error}\`);` | `hardenedFetch` rejecting an admin-typed URL (instrument fetch, SMS gateway test) throws a plain `Error` ⇒ 500 unless every caller catches. Needs review per caller. | P2 needs review |
| CS-063 | apps/api/src/modules/backup/routes.ts:222 | `return reply.code(500).send({ error: 'RESTORE_FAILED', message: err.message \|\| 'Database restore failed.' });` | Catch-all forwards arbitrary `err.message` (pg_restore stderr, Prisma text with source path) to the client. SUPER_ADMIN-only, but contradicts the "only AppError messages leave catch blocks" rule in CLAUDE.md. | P2 |
| CS-064 | apps/api/src/modules/pm-schedules/routes.ts:256 | `return reply.code(400).send({ error: 'PARSE_ERROR', message: \`Failed to parse file: ${e.message ?? String(e)}\` });` | xlsx-library message forwarded verbatim. | P3 |
| CS-065 | apps/api/src/modules/ldap/ldap.service.ts:173 | `return { success: false, message: \`LDAP connection failed: ${err.message \|\| err}\` };` | 200 + ldapjs error text (may include server host/DN). Admin-only test endpoint; acceptable semantics, message leak needs review. | P3 |
| CS-066 | apps/api/src/modules/deployment-check/routes.ts:59,73,154 | `message: err.message` / `message: e.message` | Prisma connection error text in check output. SA diagnostic endpoint. | P3 |
| CS-067 | apps/api/src/modules/backup/backup.repository.ts:26,293 | `throw new Error(\`Refusing to use unsafe SQL identifier: …\`)` / `throw new Error(\`Could not parse PostgreSQL server_version …\`)` | Reach the client via CS-063 as 500 RESTORE_FAILED. | P3 |
| CS-068 | apps/api/src/modules/notification-delivery/channels/email-channel.ts:89,136,148,165 | `throw new Error(\`Microsoft OAuth2 token error: ${err}\`)` | Caught by the channel wrapper → `success:false`; token-endpoint body embedded in the stored `notificationLog.error`. | P3 |
| CS-069 | apps/api/src/modules/dashboards/routes.ts:266 | `if (!dashboard) return reply.code(404).send({ error: 'Dashboard not found' });` | Ad-hoc `{ error: '<sentence>' }` shape instead of `{ error: CODE, message }` used everywhere else; client code keyed on `err.error` codes gets a sentence. | P3 |

---

## 4. Missing input validation on mutating routes

Scan: all `app.(post|put|patch|delete)(` registrations in the 58 route files under `apps/api/src/modules` (perl, brace-matched). **206 mutating routes.** Flags: `NO_BODY` = no `schema.body` (42: 20 DELETE, 16 POST, 6 PUT); `BODY_NO_PROPERTIES` = `body: { type: 'object' }` with no `properties` (17: 15 PUT, 1 POST, 1 PATCH); `TOP_ADDITIONAL_TRUE` = properties declared but top-level `additionalProperties: true` (3, all DELETE-with-reason, acceptable); `BODY_REF` = body is a named constant (22, all `super-admin/routes.ts` + 2 asset review/approve — not inspected, assumed fine). 136 OK.

Of the 59 NO_BODY + BODY_NO_PROPERTIES: 20 DELETEs, 8 multipart uploads (`bulk-upload-filters` ×2, `backup/restore`, `backup/validate`, `pm-schedules/upload`, `replacement-schedule/validate`, `replacement-schedule POST /`, `uploads/photo`) and 11 no-payload actions (`auth/refresh`, `resubmit`, notification `toggle`/`test`/`read`/`unread`/`mark-all-read`, debug-traces `toggle`, users `enable`/`disable`, `password-expiry-sweep`, `deviations/sweep`, `deviations/:id/acknowledge`) are legitimate. **20 genuinely accept an unvalidated object:**

| ID | file:line | route | snippet | why it matters | Sev |
|---|---|---|---|---|---|
| CS-070 | apps/api/src/modules/config/dynamic-routes.ts:64 | `PUT /api/config/dynamic/:moduleKey` | `schema: { tags: ['Config'], summary: … }` (no body) | Generic writer for **all 38** config defs. Validation is `if (def.zodSchema)` (:102) / `def.hooks.validate` (:113) — **0 of 38 defs define either** (grep). Body is upserted verbatim into `system_config` minus `_`-prefixed keys. Any CONFIG_UPDATE holder can store arbitrary JSON (wrong types, extra keys, oversized blobs) under session, password-policy, login-security, stage-interlock, pm-schedule-settings, etc. Consumers like `plugins/auth.ts:35` then read `sessionDurationHours ?? 8` from whatever is there. | **P1** |
| CS-071 | apps/api/src/modules/config/routes.ts:87 | `PUT /api/config/:key` (legacy per-key writer) | `body: { type: 'object', description: … }` | Same as CS-070 for the static keys; 0 inline validation hits. | P1 |
| CS-072 | apps/api/src/modules/config/static-routes/access-matrix.routes.ts:17 | `PUT /access-matrix` | `body: { type: 'object', additionalProperties: true }` | Role→module grant matrix; an arbitrary shape is stored and later read by the sidebar/RBAC. 0 validation hits in handler. | P1 |
| CS-073 | apps/api/src/modules/config/static-routes/action-reauth.routes.ts:26 | `PUT /action-reauth` | `body: { type: 'object', additionalProperties: true }` | Re-auth policy (§11 e-signature gating). Unknown action keys / non-array values accepted. 0 validation hits. | P1 |
| CS-074 | apps/api/src/modules/config/static-routes/tablet-access.routes.ts:17 | `PUT /tablet-access` | `body: { type: 'object', additionalProperties: true }` | Decides who may log in on the tablet (`lib/tablet-access.ts`). 0 validation hits. | P1 |
| CS-075 | apps/api/src/modules/config/static-routes/audit-templates.routes.ts:21 | `PUT /audit-templates` | same | Audit-trail rendering templates; a malformed template breaks the inspector view. | P2 |
| CS-076 | apps/api/src/modules/config/static-routes/report-signatories.routes.ts:22 | `PUT /report-signatories` | same | Report signature block content; 0 validation hits. | P2 |
| CS-077 | apps/api/src/modules/config/static-routes/report-page-titles.routes.ts:47 | `PUT /report-page-titles` | same | 0 validation hits. | P2 |
| CS-078 | apps/api/src/modules/config/static-routes/branding.routes.ts:22 | `PUT /branding` | same | 0 validation hits (logo/base64 size unbounded except 10 MB global). | P2 |
| CS-079 | apps/api/src/modules/config/static-routes/export-options.routes.ts:20 | `PUT /export-options` | same | 0 validation hits. | P3 |
| CS-080 | apps/api/src/modules/config/static-routes/offline-cache.routes.ts:47 | `PUT /offline-cache` | same | Drives tablet cache TTLs; wrong type silently breaks caching. | P2 |
| CS-081 | apps/api/src/modules/config/static-routes/pm-schedule-filters.routes.ts:20 | `PUT /pm-schedule-filters` | same | 0 validation hits. | P3 |
| CS-082 | apps/api/src/modules/config/static-routes/replacement-schedule-filters.routes.ts:20 | `PUT /replacement-schedule-filters` | same | 0 validation hits. | P3 |
| CS-083 | apps/api/src/modules/config/static-routes/cleaning-profile-assignment.routes.ts:38 | `PUT /cleaning-profile-assignment` | properties declared but `additionalProperties:true` nested; flagged in first pass only | Block→profile map used offline by the tablet. Needs review. | P2 needs review |
| CS-084 | apps/api/src/modules/config/static-routes/dashboard-cards.routes.ts:27 | `PUT /dashboard-cards` | nested `additionalProperties:true` | Needs review. | P3 |
| CS-085 | apps/api/src/modules/config/static-routes/report-labels.routes.ts:32 / user-id.routes.ts:22 | `PUT /report-labels`, `PUT /user-id` | `body: { type: 'object', additionalProperties: true }` | 1 inline validation hit each; partial. | P3 |
| CS-086 | apps/api/src/modules/ldap/routes.ts:32 | `PUT /api/ldap/config` | `body: { type: 'object', additionalProperties: true }` | Source of trust for every LDAP login; 0 validation hits before `saveConfig(body)`. | P1 |
| CS-087 | apps/api/src/modules/ldap/routes.ts:68 | `POST /api/ldap/test-connection` | same | Only `ldap://`/`ldaps://` prefix checked in service. | P3 |
| CS-088 | apps/api/src/modules/cleaning-profiles/routes.ts:220 | `PATCH /:id/toggle-status` | `body: { type: 'object', additionalProperties: true }` | 2 validation hits inside; needs review of what fields are read. | P3 needs review |
| CS-089 | apps/api/src/modules/assets/routes/instance.routes.ts:269,630 | `POST /instances`, `PUT /instances/:id` | `attributes: { type: 'object', additionalProperties: true }`, `name: { type: 'string' }` (no maxLength) | Filter attributes are free JSON (template attributeSchema is applied in service — needs review); `name` unbounded except P2000→400. | P3 needs review |

---

## 5. Hard-coded values

### 5a. Suspicious

| ID | file:line | snippet | why it matters | Sev |
|---|---|---|---|---|
| CS-100 | apps/api/src/modules/auth/auth.service.ts:462 | `const maxAge = 365 * 24 * 60 * 60 * 1000; // 12 months` | Password-reuse check only looks at the last 12 months **in addition to** the configurable `preventReuseCount`. A user who changes password rarely can reuse one after a year even if policy says "last 12". Not exposed in Password Policy config. | P2 |
| CS-101 | apps/api/src/modules/notification-delivery/routes.ts:189,208,301 | `const host = req.headers['x-forwarded-host'] \|\| req.headers.host \|\| 'localhost:3000'; const proto = req.headers['x-forwarded-proto'] \|\| 'http';` | OAuth2 redirect URI built from request headers with an `http://localhost:3000` fallback. `x-forwarded-*` is trusted with no proxy; on an HTTPS-only deployment the default scheme is wrong. Host-header injection on the OAuth redirect (CONFIG_UPDATE-gated). | P2 needs review |
| CS-102 | apps/api/src/modules/system-health/routes.ts:44 | `'wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv'` | Drive letter `C:` hard-coded (installer puts DataRoot elsewhere); `wmic` is deprecated and absent on Windows 11 24H2+. Failure returns `{0,0,0,0}` silently (:61) so the health page shows 0% disk use. | P2 |
| CS-103 | apps/api/src/plugins/auth.ts:35 and apps/api/src/modules/auth/routes.ts:166 | `(config?.configValue as any)?.sessionDurationHours ?? 8` | Session default duplicated in two files; JWT cap is 1 h (`lib/jwt.ts:46`). Three numbers describe one policy. | P3 |
| CS-104 | apps/api/src/app.ts:184 | `origin: (corsOrigins ?? 'http://localhost:5173,http://localhost:5175,https://localhost,capacitor://localhost,http://localhost')` | Dev fallback still lists Vite's old 5173 port; harmless, but `deployment-check` warns on it (:350). | P3 |
| CS-105 | apps/web/src/routes/config/*.tsx (14 sites) | `setTimeout(() => setSaveMsg(null), 5000)`, `…2000`, `…3000`, `…4000`, `…6000` | Toast durations hard-coded per page although `apps/web/src/lib/timing-constants.ts` exists for exactly this. Inconsistent UX (2–6 s). Sites: ahu-filter-set-config:70, dashboard-cards:113, equipment-groups:268, ldap:102, user-id:95/100, cleaning-profile-editor:76, filter-operations:249, date-range-filter:126, audit-filters:40, mobile-wrapper:659/660. | P3 |
| CS-106 | apps/web/src/routes/mobile/mobile-operations.tsx:2662; apps/web/src/lib/filter-ops/use-dryer-autofetch.ts:170 | `await new Promise(r => setTimeout(r, 5_000));` | 5 s fixed waits in the operator path (instrument auto-fetch). Confirm the wait is bounded/cancellable. | P3 needs review |
| CS-107 | apps/api/src/modules/notification-delivery/delivery.service.ts:23-24 | `const MAX_RETRIES = 3; const RETRY_DELAYS = [5000, 15000, 45000];` | Named, but not configurable and not durable (see CS-002). | P3 |
| CS-108 | rfid_scan_app/app/src/main/java/com/rfid/scanner/ui/screens/readwrite/ReadWriteViewModel.kt:30 | `private val _password = MutableStateFlow("00000000")` | Default Gen2 access password pre-filled in the write/lock/kill UI. Standard factory value, but Kill with an empty kill password is one tap away. | P3 needs review |
| CS-109 | rfid_scan_app/app/src/main/AndroidManifest.xml:22 | `android:allowBackup="true"` | Scanner app data (last-scanned EPCs) included in device backups. | P3 |
| CS-110 | apps/api/src/modules/backup/pg-tools.ts:46 | `` dirs.push(`C:\\Program Files\\PostgreSQL\\${major}\\bin`) `` | Probe path; overridable by `PG_BIN_DIR`. Fine unless PostgreSQL is installed elsewhere and the env var is unset — then backup is 503 `PgToolError` (handled). | P3 |

### 5b. Fine (named constant, env-overridable, or documented)

`app.ts:159` bodyLimit 10 MB; `app.ts:243` HSTS maxAge 1 y; `app.ts:274` multipart 5 MB; `admin-requests/routes.ts:40` bodyLimit 16 KB; `lib/jwt.ts:46` `JWT_EXPIRY_HOURS` default 1; `lib/offline-replay-token.ts:69` TTL 24 h; `lib/offline-time-window.ts:37-38` 5 min skew / 30 d staleness; `lib/log-retention.ts:34` 7 days (env); `plugins/auth.ts:283` 24 h absolute session; cache TTLs `reauth-check.ts:90` 10 s, `super-admin-lock.ts:26` 5 s, `plugins/auth.ts:27,48,104` 60/60/30 s, `plugins/rbac.ts:32` 5 s, `instance.routes.ts:24` 30 s, `filter-fields.service.ts:37` 10 s, `audit/routes.ts:17` 60 s, `config-loader.ts:9` 30 s; `backup.service.ts:20` 2 GB decompressed cap; `backup/routes.ts:127,272` 100 MB upload; `uploads/routes.ts:18` `MAX_FILE_SIZE` env; `auth.service.ts:459,471` defaults 12 / 90 d (overridden by policy); seed password is env-only (`prisma/seed.ts:131-133` throws without `INITIAL_ADMIN_PASSWORD`); IPs in `scripts/*.ps1` are examples driven by `digilog-addresses.ini`; IPs in `apps/web` are placeholders/error-text examples.

---

## 6. Frontend dead / placeholder controls and casts

Greps over `apps/web/src` (non-test): `onClick={() => {}}` 0; `href="#"` 0; `disabled={true}` 0; literal `disabled` 1; `console.log(` **0** (web) and 0 (api, excluding scripts); `alert(`/`confirm(` 20 lines; `eslint-disable` 32 (20 `no-console` with rationale, 11 `react-hooks/exhaustive-deps`, 1 `no-useless-return`); `@ts-ignore`/`@ts-expect-error` 0; `as any` totals: api 451, web 211, shared 2.

| ID | file:line | snippet | why it matters | Sev |
|---|---|---|---|---|
| CS-090 | apps/web/src/routes/filter-management/ahu-dashboard.tsx:90 | `<button disabled … title="Coming soon">Swap Sets</button>` | Dead control (see CS-004). | P3 |
| CS-091 | apps/web/src/routes/config/notification-rules/index.tsx:258,260,718 | `alert(result.success ? result.message : result.error);` / `alert(err.message);` | Native `alert()` for test-rule and template errors; shows raw server text (CS-060); not themed; blocks the tab. | P2 |
| CS-092 | apps/web/src/routes/mobile/mobile-operations.tsx:2691; mobile-wrapper.tsx:181, 1193; filter-management/components/equipment-dialog.tsx:199 | `if (!window.confirm(\`These readings are OUTSIDE the operating range:…Submit anyway?\`)) return;` | Out-of-range instrument reading override uses a native `confirm()` on the tablet — no audit of the override reason, no themed dialog, and WebView dialog behaviour differs from browser. | P2 |
| CS-093 | apps/web/src/routes/filter-management/filter-operations.tsx:1886,2006; mobile-operations.tsx:3627; mobile-wrapper.tsx:1193 | `if (confirm('Clear all pending operations? They will not be synced.')) { await clearQueue(); …}` | Destroys queued offline work behind a native confirm with no reason capture. **Protected surface adjacency — report only.** | P2 needs review |
| CS-094 | apps/web/src/routes/checklist-admin/list.tsx:75; config/equipment-groups.tsx:184; config/notification-rules/index.tsx:237,567,724; filter-management/cleaning-profile-editor.tsx:179; config/cleaning-profile-assignment.tsx:123; cleaning-cycles/filter-lifecycle.tsx:629 | `if (!window.confirm(\`Delete "${name}"? This cannot be undone.\`)) return;` | 8 more native `confirm()` deletes/warnings; rest of app uses a themed confirm dialog. | P3 |
| CS-095 | apps/web/src/routes/filter-management/components/drying-filters-panel.tsx:123,367; filter-list.tsx:735; filter-operations.tsx:413; use-filter-operations-offline-cache.ts:265,283; mobile-operations.tsx:1872; mobile-wrapper.tsx:213; dynamic-config.tsx:155; version-history/index.tsx:96 | `// eslint-disable-next-line react-hooks/exhaustive-deps` | 11 effect-dependency suppressions, 4 of them in the tablet operations path — classic stale-closure source. | P3 needs review |
| CS-096 | apps/api/src/plugins/auth.ts:35; modules/auth/routes.ts:166; modules/auth/session-sweep.ts:26 | `(config?.configValue as any)?.sessionDurationHours ?? 8` | Session config read via `as any` with silent default (ties to CS-070: nothing validates what is stored). | P3 |
| CS-097 | apps/api/src/modules/auth/auth.service.ts:102,128 | `user = await ldapService.provisionUser(…) as any;` / `if ((user as any).authSource === 'ldap' …` | LDAP user shape cast around the Prisma type; `authSource` not on the model type. | P3 |
| CS-098 | apps/api/src/lib/reauth-check.ts:84,266,308 | `(req as any)._reauthVerified = true;` | Re-auth state carried as untyped request mutation; a typo in a reader silently disables the gate. | P3 |
| CS-099 | apps/web/src/lib/api-client.ts:33-125 | `(error as any).status = res.status; (error as any).code = err.error; …` | Error decoration via `as any` (10 lines); consumers test `err.code`. Fine but untyped. | fine |

---

## 7. Test smells

261 test files (`*.test.ts(x)`, `__tests__/`, `e2e/`). Greps: `.skip/.only/.todo` 17 lines (12 real `it.skip`, 1 `describe.skipIf`, rest comments); commented-out `expect(` 0; hard sleeps (`setTimeout(r, N)`, `sleep(`, `waitForTimeout`) 0; `.catch(() => {})` in tests 12 (all teardown cleanup); files without a single `expect` 1 (`e2e/test-helper.ts`, a helper).

| ID | file:line | snippet | why it matters | Sev |
|---|---|---|---|---|
| CS-120 | apps/api/src/e2e/entities.test.ts:76,81,85,89,94,98,132 | `it.skip('POST /api/assets/instances creates an instance from template', …)` ×7 | The whole asset-instance CRUD e2e (create/get/update/status/children/delete) is skipped "needs an instance fixture". No e2e coverage of the filter create/edit API. | P2 |
| CS-121 | apps/api/src/e2e/phase3-rfid-offline.test.ts:432 | `it.skip('POST /api/filters/:id/advance preserves offlinePerformedAt timestamp on FilterEvent (requires cycle setup)'` | Offline-replay timestamp preservation is a §11 attribution guarantee and is untested at e2e level. | P2 |
| CS-122 | apps/api/src/modules/filter-operations/__tests__/concurrent-operator.test.ts:446,478,537,615 | `it.skip('ALREADY_SUBMITTED — n/a for advance; no checklist-event duplicate check', …)` | Documented "n/a" cases kept as skips; fine as documentation, but the titles record that advance/bypass have **no duplicate-event check** — see CS-140. | P3 |
| CS-123 | tests/integration/windows-server-stack.test.ts:77 | `describe.skipIf(!GATED)('windows-server-stack (Phase 5 end-to-end)'` | Gated by env; registers 2 skipped tests when ungated (documented). | fine |
| CS-124 | apps/api/src/e2e/audit-chain.test.ts:224,226 | `await prisma.$executeRawUnsafe(\`ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_delete\`).catch(() => {})` | Test disables the §11 no-delete trigger and swallows failure of the re-enable; if the test DB is ever pointed at `digilog_db` (see memory: `migrate reset` wiped dev DB once) the trigger could stay disabled. | P3 needs review |
| CS-125 | apps/api/src/modules/replacement-schedule/__tests__/blocked-filters.test.ts:83-89; e2e/replacement-audit-enrichment.test.ts:50-51; equipment-groups/__tests__/set-active-in-use-guard.test.ts:113 | `await prisma.assetInstance.delete({ where: { id } }).catch(() => {});` | Cleanup-only swallows; leaked fixtures accumulate in `digilog_test_db` and can collide on unique names (`asset_instances_active_name_key`). | P3 |

---

## 8. Security-adjacent

Greps: `$queryRawUnsafe|$executeRawUnsafe` 35 (8 with `${}` interpolation); `dangerouslySetInnerHTML|eval(|new Function(` 0; `child_process` 2 modules; `path.join/resolve` with request input 0 (uploads use `randomUUID`, :96); `Math.random` 4; JWT via `jose` with `algorithms: ['HS256']` pinned.

| ID | file:line | snippet | why it matters | Sev |
|---|---|---|---|---|
| CS-130 | apps/api/src/modules/audit/routes.ts:886,888,949,951; super-admin/routes.ts:774,776 | `` await tx.$executeRawUnsafe(`ALTER TABLE "audit_trail" DISABLE TRIGGER "${t.tgname}"`) `` | Interpolated identifier comes from a `pg_trigger` query (DB-sourced, not user input) — fine, but this is the hard-delete path that **breaks the hash chain** (documented). QA: verify `verify-chain` reports invalid afterwards and that ENABLE runs on rollback. | P2 needs review |
| CS-131 | apps/api/src/modules/backup/backup.repository.ts:356,587,692,749-911 | `` `SELECT * FROM "${table}"${orderClause}` `` etc. | 25 interpolated identifiers, all passed through `assertSafeIdentifier` (:26) or taken from `information_schema`/`pg_trigger`. `DROP SCHEMA public CASCADE` (:314) is the restore path. Fine by construction; regression risk if a new call skips the assert. | P3 |
| CS-132 | apps/api/src/modules/config/config.repository.ts:96,103 | `` prisma.$queryRawUnsafe(`SELECT MAX(CAST(SUBSTRING(username FROM '\\d+$') …)) … WHERE username LIKE $1`, `${prefix}%`) `` | Parameterised; `prefix` is admin config. `LIKE` with an unescaped `%`/`_` in prefix mis-counts the next User ID. | P3 |
| CS-133 | apps/api/src/modules/system-health/routes.ts:3,43,55 | `import { exec } from 'node:child_process'` … `execAsync('wmic …')` | Fixed command strings, no user input. See CS-102 for the deprecation/drive-letter issue. | P3 |
| CS-134 | apps/api/src/modules/backup/pg-tools.ts:121 | `child = spawn(bin, args, { windowsHide: true, env: … })` | Args array (no shell); `bin` from probed dirs / `PG_BIN_DIR`. Fine. | fine |
| CS-135 | apps/web/src/lib/offline-store.ts:317 | `const r = (Math.random() * 16) \| 0;` (UUID v4 fallback for `clientOpId`) | Idempotency key from `Math.random` when `crypto.randomUUID` is absent (old WebView). Collision ⇒ a replayed op is treated as a duplicate and dropped. **Protected surface, report only.** | P3 protected |
| CS-136 | apps/web/src/hooks/use-single-tab.ts:14; lib/offline-store.ts:609,824 | `tabId = Math.random().toString(36)…`; `` `op-${Date.now()}-${Math.random()…}` `` | Local ids only; fine. | fine |
| CS-137 | apps/api/src/lib/jwt.ts:60,74 | `jose.jwtVerify(token, JWT_SECRET, { algorithms: ['HS256'] })` | No `issuer`/`audience` claim; session binding is done via `sessionId` lookup in `plugins/auth.ts`. Dev mode generates a random secret when env is short (:14-16, warns). Fine; needs review that prod `.env` always sets ≥32 chars (installer). | P3 needs review |
| CS-138 | apps/api/src/modules/notification-delivery/routes.ts:189-191 | `const redirectUri = \`${proto}://${host}/api/notification-settings/email/oauth2/code\`` | Host-header-derived OAuth redirect (see CS-101). | P2 needs review |
| CS-139 | apps/api/src/modules/dashboards/routes.ts:252 | `widgetType: { type: 'string', enum: [… 'html_widget', 'image'] }` | API accepts an `html_widget` type with free `config: { type: 'object' }`; no web renderer exists today (0 `innerHTML` hits) so it is inert — but it is a stored-HTML widget waiting for a renderer. | P3 |

---

## 9. Concurrency: read-then-write without transaction or unique key

Scan: in `apps/api/src/modules` (non-test), a `prisma.X.findFirst/findUnique` followed within 40 lines by a non-`tx.` `prisma.Y.create` → 17 candidates. `$transaction(` is used 84 times in modules. Schema has 10 `@@unique` + 29 `@unique`. Optimistic-lock style fields: `AssetTemplate.version` (schema:576), the four `*Version` sidecars (`@@unique([…, versionNumber])`), `tapeVersion` on cycles (checked in `/advance`, 409 STALE_TAPE). `version` is incremented (`checklist-profile.service.ts:75`, `equipment-groups.service.ts:76`, `filter-profile.service.ts:67`) but **never used in a `where` on update** — concurrency is caught only when the sidecar INSERT hits P2002 (documented in `app.ts:380`). `updatedAt` is never used as a lock.

| ID | file:line | snippet | why it matters | Sev |
|---|---|---|---|---|
| CS-140 | apps/api/src/modules/pm-schedules/pm-executions.ts:38→46 | `const existing = await prisma.pmExecution.findFirst({ where: { scheduleEntryId, status: 'IN_PROGRESS' } }); if (existing) throw …; … await prisma.pmExecution.create({ data: { scheduleEntryId, …, status: 'IN_PROGRESS'` | No unique index on `(scheduleEntryId, status)` (schema: only `@@index`), no transaction. Two operators tapping Start on the same PM task within the same ~100 ms both get an IN_PROGRESS execution; the second completion then has two rows to credit. Tablet batch starts make this plausible. | **P1** |
| CS-141 | apps/api/src/modules/block-change-requests/block-change.service.ts:34→45 | `const existing = await prisma.blockChangeRequest.findFirst({ where: { filterId, toBlockId, status: 'PENDING' } }); if (existing) throw new AppError(409, 'DUPLICATE_REQUEST' …); … prisma.blockChangeRequest.create({` | Same pattern, no unique, no tx → duplicate PENDING requests; two approvers can each approve one. | P2 |
| CS-142 | apps/api/src/modules/pm-schedules/pm-schedule-crud.ts:43→60 | `findFirst({ where: { entityId, year, status: 'ACTIVE' } })` → `pmSchedule.create` | Covered by `@@unique([entityId, year, version])` for version 1 → loser gets generic 409 "modified concurrently" instead of the intended "Active PM schedule already exists". Message mismatch only. | P3 |
| CS-143 | apps/api/src/modules/users/user.repository.ts:68→86 | `findByUsernameOrEmail` … `prisma.user.create` | `username`/`email` are `@unique`, so the race is safe, but the loser sees "This record was modified concurrently. Please reload" rather than "username already exists". | P3 |
| CS-144 | apps/api/src/modules/assets/repositories/identifier.repository.ts:38→49; relationship.repository.ts:30→41; template.repository.ts:35→60 | find-by-key then create | All three keys are unique (`identifierValue`, `[source,target,type]`, `AssetTemplate.name`) → P2002 → 409. Safe; message generic. | fine |
| CS-145 | apps/api/src/modules/dashboards/routes.ts:265→268; admin-request.service.ts:121/142→148; notification.repository.ts:17→30; super-admin/routes.ts:1177,1315,1372,1456 | existence check then create | Not duplicate guards (FK/404 checks or SA console creates); no race semantics. | fine |
| CS-146 | apps/api/src/modules/{checklist-profiles,equipment-groups,filter-profiles}/*.service.ts:75/76/67 | `data: { version: { increment: 1 } }` | Version bump is not conditioned on the version the client edited (`where: { id }` only). Lost-update between two web editors is only detected if their sidecar INSERTs collide on `versionNumber`. Documented design; QA: two editors, same record, confirm second save gets 409 not silent overwrite. | P2 needs review |

---

## Top 10 most likely real defects (for the campaign)

1. **CS-070 / CS-071** — `PUT /api/config/dynamic/:key` and `PUT /api/config/:key` validate nothing: 0 of 38 config defs define `zodSchema` or a `validate` hook. Any CONFIG_UPDATE holder can store arbitrary JSON under session / password-policy / login-security / stage-interlock / tablet-access.
2. **CS-140** — PM execution start: `findFirst(IN_PROGRESS)` → `create` with no unique key and no transaction → duplicate IN_PROGRESS executions under concurrent taps.
3. **CS-072 / CS-073 / CS-074 / CS-086** — access-matrix, action-reauth, tablet-access and LDAP config PUTs accept `additionalProperties: true` with no inline validation; these drive RBAC, §11 re-auth gating, tablet login and the login directory.
4. **CS-061** — `typed-asset-dispatch.ts` throws plain `Error` for "Template/Asset not found" in a request path → 500 + SYSTEM_ERROR notification instead of 404.
5. **CS-002 / CS-107** — notification retries are in-process `setTimeout`s; a restart strands the log row in a non-terminal status.
6. **CS-100** — password-reuse check silently limited to 12 months regardless of the configured `preventReuseCount`.
7. **CS-141** — duplicate PENDING block-change requests via the same read-then-create race.
8. **CS-040 / CS-042** — tablet path: `onBeforeDeferredChecklist` failure proceeds after a `console.error`; offline-grant mint failure logs only, so the operator goes offline without a grant and is not told.
9. **CS-060 / CS-091** — notification-rule test endpoint returns 200 `{ success:false, error: err.message }` and the UI `alert()`s the raw server text.
10. **CS-102** — system-health disk check shells out to deprecated `wmic` against a hard-coded `C:`; on Windows 11 24H2+ it fails and the health page reports 0% disk silently.

Honourable mentions: CS-010 (equipment-group edit proceeds when the active-cycle check errors), CS-031/CS-032 (`getCache().catch(() => null)` turns an IndexedDB fault into "no active cycle" on both web and tablet), CS-092 (out-of-range reading override via native `confirm`, no audit of the override), CS-120/CS-121 (asset CRUD and offline-timestamp e2e tests skipped).

---

## Footnote — commands run (GNU grep / perl under Git Bash; no node processes started)

```
# cat 1
grep -rnEi --include='*.ts' --include='*.tsx' --include='*.kt' --include='*.java' --include='*.ps1' --include='*.bat' <EXCLUDES> '\b(TODO|FIXME|XXX|HACK)\b|not implemented|coming soon|placeholder' apps packages scripts rfid_scan_app | grep -vE '__tests__|\.test\.|placeholder=|…'
grep -rnE --include='*.ts' --include='*.tsx' <EXCLUDES> -iE '\b(TODO|FIXME|XXX|HACK)\b|not implemented|coming soon' apps packages | grep -vE '__tests__|\.test\.' | wc -l   # 5
# cat 2
grep -rnE 'catch\s*(\([^)]*\))?\s*\{\s*\}' …                                     # single-line empty catch: 4
perl -0777 -ne 'while (/catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*\n\s*)*\}/g) …' # multiline empty/comment-only: 16
grep -rnE '\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|null|undefined|false|void 0|0)\s*\)' … # 26
grep -rnE -A3 'catch\s*(\([^)]*\))?\s*\{\s*$' … | grep -E '^\S+-[0-9]+-\s*console\.(log|warn|error|debug)' # 11
grep -rnE '\bcatch\b' apps/api/src apps/web/src packages/shared/src | grep -vE '__tests__|\.test\.' | wc -l  # 544
# cat 3
grep -rnE '(reply|res)\.send\(\s*(err|error|e)\b|message:\s*(err|error|e)\.message|…' apps/api/src   # 23 lines, filtered by hand
grep -rnE 'success:\s*false' apps/api/src | wc -l                                  # 24
grep -rnE 'throw new Error\(' apps/api/src | grep -vE '__tests__|\.test\.' | wc -l # 21 ; modules/ → 6
# cat 4
perl routes_scan2.pl <each of 58 route files>   # brace-matched extraction of options → schema → body; flags OK/NO_SCHEMA/NO_BODY/BODY_NO_PROPERTIES/TOP_ADDITIONAL_TRUE/BODY_REF  (206 routes)
grep -L 'zodSchema' apps/api/src/modules/config/defs/*.def.ts | wc -l              # 38 of 38
grep -lE 'validate' apps/api/src/modules/config/defs/*.def.ts | wc -l              # 0
# cat 5
grep -rnE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' …; grep -rnE 'localhost|:3000\b|:5175\b|:5432\b|192\.168|10\.121' …
grep -rnEi '(password|passwd|secret|apikey|api_key|token)\s*[:=]\s*["'"'"'][^"'"'"'$\{]{4,}["'"'"']|Admin@123' …   # 0 real hits
grep -rnE '[A-Z]:\\\\|/Users/hello|C:/Users|ProgramData|Program Files' …
grep -rnE 'set(Timeout|Interval)\([^;]*,\s*[0-9_]{4,}\s*\)' … | wc -l             # 24
grep -rnE '[0-9]+\s*\*\s*(60|24|1000|1024)\s*\*' … | wc -l                        # 61
grep -rnEi '(retention|expir|lockout|…|ttl)[A-Za-z_]*\s*[:=]\s*[0-9]+' apps/api/src
# cat 6
grep -rnE 'onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}' apps/web/src                 # 0
grep -rnE '<button[^>]*\sdisabled(\s|>|$)' apps/web/src | grep -v 'disabled=\{'    # 1
grep -rnE 'href="#"' …  # 0 ; grep -rnE '(^|[^.a-zA-Z_])(window\.)?(alert|confirm)\(' … # 20
grep -rnE 'console\.log\(' apps/web/src | grep -vE '\.test\.|__tests__' | wc -l    # 0
grep -rnE 'eslint-disable' … | wc -l                                               # 32
grep -rnE 'as any' <auth/permission files>                                         # 25
# cat 7
find … \( -name '*.test.ts' -o -name '*.test.tsx' -o -path '*/__tests__/*' -o -path '*/e2e/*' \) | wc -l   # 261
xargs grep -nE '\b(it|test|describe)\.(skip|only|todo|skipIf|runIf)\b|\bxit\(|\bxdescribe\('           # 17 lines
xargs grep -nE '^\s*//\s*(expect|assert)\('  # 0 ; sleeps: 'setTimeout\(\s*(r|res|resolve)\s*,\s*[0-9]+|\bsleep\([0-9]|waitForTimeout\(' # 0
xargs grep -nE 'catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null)\s*\)'          # 12
# cat 8
grep -rnE '\$(queryRawUnsafe|executeRawUnsafe)\(' apps/api/src | wc -l            # 35 ; with '\$\{' → 8
grep -rnE 'dangerouslySetInnerHTML|\beval\(|new Function\(' …                      # 0
grep -rnE "child_process|execSync\(|spawnSync\(|execFile\(|\bspawn\(|\bexec\(" apps/api/src
grep -rnE 'Math\.random\(' …  # 4 ; grep -rnE 'jwt\.(verify|sign|decode)\(|jsonwebtoken' # 0 (jose used)
# cat 9
perl race_scan.pl <each module .ts>   # findFirst/findUnique followed within 40 lines by a non-tx prisma.*.create  → 17
grep -rn '\$transaction(' apps/api/src/modules | wc -l                             # 84
grep -nE '@@unique' apps/api/prisma/schema.prisma | wc -l  # 10 ; '@unique' → 29
grep -rnE 'version:\s*\{\s*increment' apps/api/src                                 # 3
```
