# DigiLog — Bug Resolution Log

**Maintained by:** Engineering Team
**Created:** 2026-02-25
**Last Updated:** 2026-02-25 (v2.2.2)
**Policy:** Every bug MUST be documented here before closing the associated Git issue.

---

## Summary Metrics

| Metric | Count |
|--------|-------|
| Total Bugs Identified | 14 |
| Total Resolved | 14 |
| Open Issues | 0 |
| Git Issues Created | 13 (#2–#14) |
| Git Issues Closed | 13 |
| Recurring Patterns | 5 (Fastify schema serialization, async race conditions, UUID-as-targetId in audit, test helper missing app config, unguarded API response `.map()`) |

---

## Bug Entries

### BUG-001: `checklistSchema` stripped from GET `/templates/:id` response

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-001 |
| **Git Issue** | [#2](https://github.com/pankajexa/21cfrlogbook/issues/2) (closed) |
| **Bug Title** | `checklistSchema` stripped from GET `/templates/:id` response |
| **Date Identified** | 2026-02-21 |
| **Module** | Entity Management — Templates |
| **Severity** | HIGH |
| **Root Cause Analysis** | Fastify response serialization removes any property not declared in the route's Swagger/JSON response schema. The `checklistSchema` field was present in the database and returned by Prisma, but was silently stripped during serialization because it was not listed in the GET-by-ID response schema properties. |
| **Technical Explanation** | Fastify 5 uses `fast-json-stringify` for response serialization. When a response schema is declared, any property NOT in the schema is dropped. The POST and PUT routes had `checklistSchema` in their response schemas, but the GET `:id` route did not. |
| **Code-Level Fix** | Added `checklistSchema: { type: 'array' }` to the GET `/templates/:id` Swagger response schema in `apps/api/src/modules/assets/routes/template.routes.ts`. |
| **Preventive Measures** | All new fields added to Prisma models must also be added to ALL route response schemas (GET list, GET by ID, POST, PUT). Added to PR review checklist. |
| **Testing Done** | E2E test `checklist-templates.test.ts` — 14 tests verifying checklistSchema persistence through create/read/update/delete cycle. |
| **Resolution Date** | 2026-02-21 |
| **Linked Commit** | `9f2776f` |
| **Linked PR** | N/A |

---

### BUG-002: Audit template placeholder mismatch (`FORCED_LOGOUT`)

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-002 |
| **Git Issue** | [#3](https://github.com/pankajexa/21cfrlogbook/issues/3) (closed) |
| **Bug Title** | Audit template placeholder mismatch for `FORCED_LOGOUT` action |
| **Date Identified** | 2026-02-21 |
| **Module** | Audit Trail — Templates |
| **Severity** | LOW |
| **Root Cause Analysis** | `FORCED_LOGOUT` audit template declared `actor` in its `placeholders` array, but the template string only used `{targetUser}`. This was a data-level inconsistency — functional behavior was correct. |
| **Technical Explanation** | The `AUDIT_TEMPLATE_DEFAULTS` object in `packages/shared/src/types/audit-templates.ts` defines each action's template string and required placeholders. The `FORCED_LOGOUT` entry listed `['actor', 'targetUser']` as placeholders but the template was `"User {targetUser} session was terminated"`, never referencing `{actor}`. |
| **Code-Level Fix** | Documented as known data-level exception. Updated placeholder array to match actual template usage. |
| **Preventive Measures** | Added unit test in `audit-templates.test.ts` that validates every placeholder listed in the array is actually used in the template string. |
| **Testing Done** | 17 audit template unit tests including placeholder consistency validation. |
| **Resolution Date** | 2026-02-21 |
| **Linked Commit** | `9f2776f` |
| **Linked PR** | N/A |

---

### BUG-003: Missing reauth on identifier endpoints

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-003 |
| **Git Issue** | [#4](https://github.com/pankajexa/21cfrlogbook/issues/4) (closed) |
| **Bug Title** | Missing `enforceReauth()` on POST/DELETE `/identifiers` endpoints |
| **Date Identified** | 2026-02-20 |
| **Module** | Entity Management — Identifiers |
| **Severity** | MEDIUM |
| **Root Cause Analysis** | POST and DELETE `/api/assets/identifiers` were the only mutation endpoints in the entity management module that lacked `enforceReauth()` calls. This was an oversight during initial implementation — all other entity mutation endpoints had reauth enforcement. |
| **Technical Explanation** | The `enforceReauth()` middleware checks if the current user's role requires re-authentication for the given action. Without it, sensitive operations (creating/deleting physical identifiers like QR codes and RFID tags) could be performed without password confirmation, violating 21 CFR Part 11 transaction safeguards. |
| **Code-Level Fix** | Added `enforceReauth('CREATE_ASSET_IDENTIFIER')` to POST `/identifiers` and `enforceReauth('DELETE_ASSET_IDENTIFIER')` to DELETE `/identifiers/:id`. Added corresponding reauth action constants to shared package. |
| **Preventive Measures** | All new mutation endpoints must include `enforceReauth()` — added to development checklist. RBAC test script (`rbac-test.sh`) validates reauth enforcement. |
| **Testing Done** | Manual API testing + RBAC test suite (73 tests, 100% pass). |
| **Resolution Date** | 2026-02-20 |
| **Linked Commit** | Part of Phase 2 release |
| **Linked PR** | N/A |

---

### BUG-004: Missing `await` on `reauth.execute()` causing race conditions

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-004 |
| **Git Issue** | [#5](https://github.com/pankajexa/21cfrlogbook/issues/5) (closed) |
| **Bug Title** | Missing `await` on `reauth.execute()` in delete handlers |
| **Date Identified** | 2026-02-20 |
| **Module** | Entity Management — Relationships, Templates |
| **Severity** | HIGH |
| **Root Cause Analysis** | `handleDeleteRelationship` in Entity Explorer and `handleDelete` in Template Manager called `reauth.execute()` without `await`. Since `reauth.execute()` is async (shows a dialog, waits for user input, then calls the callback), the missing `await` caused the surrounding code to continue executing before reauth completed. |
| **Technical Explanation** | `reauth.execute(actionKey, callback)` returns a Promise. Without `await`, the dialog state (closing the confirmation dialog, refreshing the list) was being saved/executed before the user had a chance to complete re-authentication. This created a race condition where the delete appeared to succeed in the UI but may not have completed on the server. |
| **Code-Level Fix** | Added `await` before all `reauth.execute()` calls in `apps/web/src/routes/assets/index.tsx` and `apps/web/src/routes/assets/templates.tsx`. |
| **Preventive Measures** | All `reauth.execute()` calls must be `await`-ed. Added as an architecture principle in CLAUDE.md. ESLint `no-floating-promises` rule recommended. |
| **Testing Done** | Manual testing of delete flows with reauth enabled. Verified dialog sequence: confirm delete → reauth prompt → password entry → delete executed → UI refreshed. |
| **Resolution Date** | 2026-02-20 |
| **Linked Commit** | Part of Phase 2 release |
| **Linked PR** | N/A |

---

### BUG-005: Three Prisma fields not exposed via API

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-005 |
| **Git Issue** | [#6](https://github.com/pankajexa/21cfrlogbook/issues/6) (closed) |
| **Bug Title** | `category`, `expectedRelationships`, `statusLifecycle` missing from template API |
| **Date Identified** | 2026-02-20 |
| **Module** | Entity Management — Templates |
| **Severity** | MEDIUM |
| **Root Cause Analysis** | Three fields existed in the Prisma schema (`AssetTemplate` model) but were not included in the Zod validation schemas or Fastify route request/response schemas. Data could be stored in the database but not created, updated, or read via the API. |
| **Technical Explanation** | The Zod `createAssetTemplateSchema` and `updateAssetTemplateSchema` in `packages/shared/src/schemas/assets.ts` did not include `category`, `expectedRelationships`, or `statusLifecycle`. The Fastify route body and response schemas also omitted them. |
| **Code-Level Fix** | Added all three fields to Zod schemas (create and update), Fastify request body schemas, and response schemas for GET list, GET by ID, POST, and PUT endpoints. |
| **Preventive Measures** | When adding Prisma model fields, ensure they are also added to: (1) Zod schemas in shared package, (2) Fastify request body schemas, (3) Fastify response schemas for ALL routes that touch the model. |
| **Testing Done** | API endpoint tests verifying fields are accepted on create/update and returned on get. |
| **Resolution Date** | 2026-02-20 |
| **Linked Commit** | Part of Phase 2 release |
| **Linked PR** | N/A |

---

### BUG-006: `maxConnections` stripped from template list response

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-006 |
| **Git Issue** | [#7](https://github.com/pankajexa/21cfrlogbook/issues/7) (closed) |
| **Bug Title** | `maxConnections` and `telemetrySchema` stripped from GET `/templates` list |
| **Date Identified** | 2026-02-20 |
| **Module** | Entity Management — Templates |
| **Severity** | MEDIUM |
| **Root Cause Analysis** | Same pattern as BUG-001. Fastify's `fast-json-stringify` response serialization strips properties not declared in the response schema. `maxConnections` and `telemetrySchema` were missing from the GET list endpoint's response schema. |
| **Technical Explanation** | The GET `/api/assets/templates` response schema declared `items` with specific properties but did not include `maxConnections` or `telemetrySchema`. These fields were returned by Prisma but silently dropped during serialization. |
| **Code-Level Fix** | Added `maxConnections: { type: 'integer' }` and `telemetrySchema: { type: 'array' }` to the GET list response schema properties. |
| **Preventive Measures** | Same as BUG-001 — all Prisma fields must be in ALL response schemas. This is a recurring pattern (see BUG-001). |
| **Testing Done** | Manual API testing verifying `maxConnections` appears in list response. |
| **Resolution Date** | 2026-02-20 |
| **Linked Commit** | Part of Phase 2 release |
| **Linked PR** | N/A |

---

### BUG-007: `parentId` coerced to empty string in API responses

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-007 |
| **Git Issue** | [#8](https://github.com/pankajexa/21cfrlogbook/issues/8) (closed) |
| **Bug Title** | `parentId` coerced from `null` to `""` in instance list response |
| **Date Identified** | 2026-02-19 |
| **Module** | Entity Management — Instances |
| **Severity** | HIGH |
| **Root Cause Analysis** | GET `/api/assets/instances` response schema declared `parentId` as `type: 'string'`. Fastify's serializer coerced `null` values to `""` (empty string) because the schema did not allow null. The tree endpoint already used `type: ['string', 'null']` correctly, creating inconsistent behavior. |
| **Technical Explanation** | Prisma returns `parentId: null` for root entities. Fastify's `fast-json-stringify` strictly follows the declared JSON schema types. When `parentId` was typed as only `string`, the serializer converted `null` → `""`. The frontend tree-building logic (`flatAssetList`) only matched `parentId === null` as root indicators, so no root nodes were found and the tree rendered empty. |
| **Code-Level Fix** | Changed `parentId` type from `{ type: 'string' }` to `{ type: ['string', 'null'] }` in the instances list response schema. Updated frontend to treat `null`, `undefined`, and `""` as root indicators. |
| **Preventive Measures** | All nullable database fields must use `type: ['string', 'null']` (or equivalent) in Fastify response schemas. Added check to development process. |
| **Testing Done** | Manual verification of tree view rendering with root entities. API response inspection. |
| **Resolution Date** | 2026-02-19 |
| **Linked Commit** | Part of 2026-02-19 release |
| **Linked PR** | N/A |

---

### BUG-008: Entity creation returning 400 for inactive templates

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-008 |
| **Git Issue** | [#9](https://github.com/pankajexa/21cfrlogbook/issues/9) (closed) |
| **Bug Title** | Entity creation rejected with 400 error for inactive templates |
| **Date Identified** | 2026-02-20 |
| **Module** | Entity Management — Instances |
| **Severity** | MEDIUM |
| **Root Cause Analysis** | POST `/api/assets/instances` contained a check `if (!template.isActive) throw new ValidationError(...)` that rejected entity creation from templates with `isActive: false`. However, the frontend template dropdown showed all templates regardless of active status. |
| **Technical Explanation** | The `isActive` check was overly restrictive. The `isActive` flag on templates is for soft-delete, not for preventing entity creation. A deactivated template should still allow entities to be created from its schema — the template's data is still valid. |
| **Code-Level Fix** | Removed the `isActive` check from POST `/api/assets/instances` handler. Entities can now be created from any template. |
| **Preventive Measures** | Clarified the semantics of `isActive` in documentation: it controls template visibility in management UI, not entity creation eligibility. |
| **Testing Done** | API testing — POST /instances with active and inactive template IDs. |
| **Resolution Date** | 2026-02-20 |
| **Linked Commit** | Part of Phase 2 release |
| **Linked PR** | N/A |

---

### BUG-009: Role Privileges page crash on Entity Management category

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-009 |
| **Git Issue** | [#10](https://github.com/pankajexa/21cfrlogbook/issues/10) (closed) |
| **Bug Title** | Role Privileges page crash — missing `CATEGORY_COLORS` entry |
| **Date Identified** | 2026-02-20 |
| **Module** | Configuration — Role Privileges |
| **Severity** | HIGH |
| **Root Cause Analysis** | The `CATEGORY_COLORS` map in `role-privileges.tsx` only had entries for `'User Management'` and `'System'` categories. When the Entity Management category was added (with entity permissions), accessing `CATEGORY_COLORS['Entity Management']` returned `undefined`, and subsequent property access (`categoryConfig.bg`) threw a TypeError crashing the page. |
| **Technical Explanation** | JavaScript object property access on `undefined` throws: `CATEGORY_COLORS['Entity Management']` → `undefined`, then `undefined.bg` → `TypeError: Cannot read properties of undefined`. React error boundary caught this as an uncaught exception, rendering the error fallback. |
| **Code-Level Fix** | Added `'Entity Management'` entry to `CATEGORY_COLORS` with teal/emerald color scheme matching the entity management theme. |
| **Preventive Measures** | When adding new permission categories to the shared package, ensure all frontend components that iterate over categories have corresponding UI configuration (colors, icons, labels). |
| **Testing Done** | Manual navigation to /config/role-privileges — verified all 3 categories render correctly. |
| **Resolution Date** | 2026-02-20 |
| **Linked Commit** | Part of Phase 2 release |
| **Linked PR** | N/A |

---

### BUG-010: Dynamic role validation — Zod enum rejection

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-010 |
| **Git Issue** | [#11](https://github.com/pankajexa/21cfrlogbook/issues/11) (closed) |
| **Bug Title** | Custom roles rejected by hardcoded Zod enum validation |
| **Date Identified** | 2026-02-17 |
| **Module** | User Management |
| **Severity** | HIGH |
| **Root Cause Analysis** | User create/update Zod schemas used `z.enum(['SUPER_ADMIN', 'ADMIN', ...])` for the role field. When dynamic custom roles were introduced (e.g., "QA", "ENGINEER"), the enum validation rejected them as invalid values. |
| **Technical Explanation** | Zod `z.enum()` creates a closed set of allowed values at schema definition time. Custom roles created via the API are stored in the database but were not known at schema compilation time. The role field needed to accept any string. |
| **Code-Level Fix** | Changed role field from `z.enum([...])` to `z.string()` in `packages/shared/src/schemas/users.ts`. Updated backend user routes to use dynamic DB lookups (`prisma.role.findMany()`) instead of hardcoded `CREATABLE_ROLES` import. |
| **Preventive Measures** | Any field that references dynamically-created database records should use `z.string()` with runtime validation, not `z.enum()`. |
| **Testing Done** | Created custom role "QA", created user with role "QA" — success. Verified role dropdown shows custom roles. |
| **Resolution Date** | 2026-02-17 |
| **Linked Commit** | Part of v1.0.0 release |
| **Linked PR** | N/A |

---

### BUG-011: Newly created roles not appearing in Role Privileges page

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-011 |
| **Git Issue** | [#12](https://github.com/pankajexa/21cfrlogbook/issues/12) (closed) |
| **Bug Title** | Role Privileges page uses hardcoded ROLES constant instead of API |
| **Date Identified** | 2026-02-17 |
| **Module** | Configuration — Role Privileges |
| **Severity** | MEDIUM |
| **Root Cause Analysis** | The Role Privileges page (`/config/role-privileges`) imported and used a hardcoded `ROLES` constant from the shared package to render role buttons. Custom roles created via the Roles management page were stored in the database but never appeared in the Role Privileges UI. |
| **Technical Explanation** | The `ROLES` constant was a static TypeScript array defined at build time. It contained only the 6 default roles. The Role Privileges page iterated over this array to render role selection buttons, completely ignoring any roles created after build time. |
| **Code-Level Fix** | Replaced hardcoded `ROLES` import with dynamic SWR fetch from `/api/roles/active`. Added `revalidateOnMount: true` and `dedupingInterval: 0` to ensure fresh data on every page visit. Uses `role.displayName` and `role.color` from database. |
| **Preventive Measures** | No frontend component should use hardcoded role lists. All role data must come from the API (`/api/roles/active`). |
| **Testing Done** | Created custom role → navigated to Role Privileges → custom role appeared immediately. |
| **Resolution Date** | 2026-02-17 |
| **Linked Commit** | Part of v1.0.0 release |
| **Linked PR** | N/A |

---

### BUG-012: Auth test — 401 error code mismatch

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-012 |
| **Git Issue** | [#13](https://github.com/pankajexa/21cfrlogbook/issues/13) (closed) |
| **Bug Title** | E2E test expects `INVALID_CREDENTIALS` but gets `Unauthorized` |
| **Date Identified** | 2026-02-17 |
| **Module** | Testing Infrastructure |
| **Severity** | LOW |
| **Root Cause Analysis** | The `buildApp()` test helper in `test-helper.ts` did not register the global error handler from `app.ts`. Without it, `AppError` instances were handled by Fastify's default error handler, which serializes 401 errors as `{ error: 'Unauthorized' }` instead of the custom `{ error: 'INVALID_CREDENTIALS' }` format. |
| **Technical Explanation** | The auth service throws `new AppError(401, 'INVALID_CREDENTIALS', ...)` for invalid logins. In production (`app.ts`), the global `setErrorHandler` catches `AppError` and returns `{ error: err.code, message: err.message }`. But the test helper's `buildApp()` didn't register this handler, so Fastify's default handler produced `{ error: 'Unauthorized' }` instead. The test expectation was correct — the test infrastructure was wrong. |
| **Code-Level Fix** | Added global error handler to `buildApp()` in `apps/api/src/e2e/test-helper.ts` that matches the `app.ts` error handler behavior — catches `AppError` instances and serializes them with `{ error: err.code, message: err.message }`. |
| **Preventive Measures** | Test helper `buildApp()` must mirror all global middleware from `app.ts`, especially error handlers. Any changes to `app.ts` error handling must be reflected in `test-helper.ts`. |
| **Testing Done** | All 116 API E2E tests now pass, including the previously failing `returns 401 for non-existent user` test. |
| **Resolution Date** | 2026-02-25 |
| **Linked Commit** | Pending (current branch `feature/user-id-config`) |
| **Linked PR** | N/A |

---

### BUG-013: Audit trail `targetId` stores UUID instead of User ID (username)

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-013 |
| **Git Issue** | [#14](https://github.com/pankajexa/21cfrlogbook/issues/14) (closed) |
| **Bug Title** | Audit trail `targetId` stores internal UUID instead of human-readable User ID |
| **Date Identified** | 2026-02-25 |
| **Module** | Audit Trail — User & Auth Services |
| **Severity** | HIGH |
| **Root Cause Analysis** | All user-related audit log calls in `user.service.ts` and `auth.service.ts` passed `user.id` (UUID, e.g., `350601b6-c407-4de0-be18-325c6f5351aa`) or the route parameter `id` (also UUID) as the `targetId` field. The audit trail frontend displays `targetId` directly, so users saw UUIDs instead of the human-readable username (e.g., "090909"). |
| **Technical Explanation** | The `auditLog()` function stores whatever `targetId` string is passed. In `user.service.ts`, 9 audit calls used `user.id` (UUID from Prisma) or route param `id` (UUID). In `auth.service.ts`, 6 audit calls used `user.id` (UUID). The `User` model has `id` (UUID primary key) and `username` (human-readable User ID). The `PasswordResetRequest.userId` field stores the username correctly, but the `PASSWORD_RESET_REQUEST_APPROVED` audit entry was using `user.id` (the looked-up User's UUID) instead. |
| **Code-Level Fix** | Changed `targetId` from UUID to username in 15 audit log calls across 2 files: `user.service.ts` (9 calls: USER_CREATED, USER_UPDATED, USER_DELETED, BULK_USER_DELETED, USER_ENABLED, USER_DISABLED, ACCOUNT_UNLOCKED, PASSWORD_RESET, PASSWORD_RESET_REQUEST_APPROVED) and `auth.service.ts` (6 calls: ACCOUNT_LOCKED, LOGIN_FAILED, PASSWORD_EXPIRED, LOGIN_SUCCESS, PROFILE_UPDATED, PASSWORD_CHANGED). Also added `fullName` to `afterValue` in PASSWORD_RESET and PASSWORD_RESET_REQUEST_APPROVED entries. |
| **Preventive Measures** | All audit log calls with `targetType: 'user'` must use `username` (not UUID) as `targetId`. UUID (`user.id`) should only appear as `targetId` when `targetType` refers to non-user entities. Added as architecture guideline. |
| **Testing Done** | Manual verification — performed password reset approval, confirmed audit trail now shows username instead of UUID in `targetId`. API restart and health check confirmed. |
| **Resolution Date** | 2026-02-25 |
| **Linked Commit** | Pending (current branch `feature/user-id-config`) |
| **Linked PR** | N/A |

---

### BUG-014: Runtime `h.map is not a function` crash on /request-account

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-014 |
| **Git Issue** | N/A (fixed in same session) |
| **Bug Title** | Runtime `h.map is not a function` crash on /request-account page |
| **Date Identified** | 2026-02-25 |
| **Module** | User Account Requests — Frontend |
| **Severity** | HIGH |
| **Root Cause Analysis** | PM2 was running a stale API build that did not include the newly registered `/api/user-requests/` endpoints. When the frontend's `/request-account` page fetched `/api/user-requests/roles`, it received a 404 JSON error object (`{ statusCode: 404, error: 'Not Found', message: '...' }`) instead of the expected role array. The code then called `.map()` on this non-array object, causing a TypeError. In the minified production build, the variable was renamed to `h`, producing the cryptic error `h.map is not a function`. |
| **Technical Explanation** | The `request-account.tsx` component fetched roles via `fetch('/api/user-requests/roles').then(r => r.json()).then(data => setRoles(data))`. Without checking `r.ok` or validating that the response was an array, it set `roles` to whatever the API returned. When PM2 served the old API build, the 404 response body was an object, and the subsequent `roles.map(r => ...)` in the JSX threw `TypeError: h.map is not a function` (minified). |
| **Code-Level Fix** | Two-part fix: (1) Rebuilt the API (`rm -rf apps/api/dist && tsc`) and restarted PM2 so the `/api/user-requests/` routes were registered. (2) Added defensive response handling in `request-account.tsx`: check `r.ok` before parsing, and wrap with `Array.isArray(data) ? data : []` before calling `setRoles()`. |
| **Preventive Measures** | All frontend `fetch()` calls to API endpoints that return arrays must: (a) check `response.ok` before parsing JSON, (b) validate with `Array.isArray()` before calling `.map()`. After deploying new backend modules, always rebuild and restart PM2. |
| **Testing Done** | `curl` verified `/api/user-requests/roles` returns proper array. Frontend tested — page loads correctly with role dropdown populated. Error path tested — graceful fallback to empty array on API failure. |
| **Resolution Date** | 2026-02-25 |
| **Linked Commit** | Pending (current branch `feature/user-id-config`) |
| **Linked PR** | N/A |

---

## Recurring Bug Patterns

### Pattern 1: Fastify Response Schema Serialization

**Bugs Affected:** BUG-001, BUG-006, BUG-007

**Pattern:** Fastify's `fast-json-stringify` silently strips properties not declared in route response schemas. When new fields are added to Prisma models, they must also be added to ALL Fastify response schemas for every route that returns that model.

**Prevention:** Maintain a checklist: Prisma field → Zod schema → Fastify request schema → Fastify response schema (all routes).

### Pattern 2: Async Race Conditions with `reauth.execute()`

**Bugs Affected:** BUG-004

**Pattern:** The `reauth.execute()` hook returns a Promise. Missing `await` causes surrounding code to execute before re-authentication completes, creating race conditions in dialog state management.

**Prevention:** All `reauth.execute()` calls must be `await`-ed. Added as architecture principle in CLAUDE.md.

### Pattern 3: UUID Used as `targetId` in Audit Trail

**Bugs Affected:** BUG-013

**Pattern:** Service-layer audit log calls used `user.id` (UUID primary key) as `targetId` for user-related actions instead of `user.username` (human-readable User ID). The audit trail frontend displays `targetId` directly, so users saw UUIDs like `350601b6-...` instead of usernames like "090909".

**Prevention:** All audit log calls with `targetType: 'user'` must use `user.username` as `targetId`. Reserve UUIDs for internal references only.

### Pattern 4: Test Helper Missing App Configuration

**Bugs Affected:** BUG-012 (+ SESSION_CONFLICT failures)

**Pattern:** The `buildApp()` test helper did not mirror all global configuration from `app.ts`. Missing the global error handler caused `AppError` instances to be serialized differently in tests vs production. Missing `force: true` in `loginAs()` caused SESSION_CONFLICT when the production DB had active sessions.

**Prevention:** Test helper `buildApp()` must include all global middleware from `app.ts` (error handler, static files, etc.). The `loginAs()` helper must always use `force: true` to ensure tests run reliably regardless of database state.

### Pattern 5: Unguarded API Response `.map()`

**Bugs Affected:** BUG-014

**Pattern:** Frontend code called `.map()` on API response data without verifying the response was successful or that the data was actually an array. When the API returned an error object (e.g., 404 response) instead of the expected array, `.map()` threw a TypeError. In minified production builds, the cryptic error message (`h.map is not a function`) made diagnosis difficult.

**Prevention:** All frontend `fetch()` calls returning arrays must: (1) check `response.ok` before parsing, (2) validate with `Array.isArray(data)` before calling `.map()`. Use a defensive pattern: `setData(Array.isArray(data) ? data : [])`.

---

## Version History

| Date | Version | Change |
|------|---------|--------|
| 2026-02-25 | 1.4 | BUG-014 added (runtime h.map crash on /request-account), new recurring pattern #5 (unguarded API response .map()), all 14 bugs resolved |
| 2026-02-25 | 1.3 | BUG-012 resolved (test helper missing global error handler), SESSION_CONFLICT fixed (force:true in loginAs), new recurring pattern #4, all 13 bugs resolved |
| 2026-02-25 | 1.2 | Added BUG-013 (audit trail UUID-as-targetId), new recurring pattern #3, updated metrics |
| 2026-02-25 | 1.1 | Git issue lifecycle: created 12 GitHub issues (#2–#13), closed 11, linked all entries |
| 2026-02-25 | 1.0 | Initial creation — cataloged 12 historical bugs from CHANGELOG.md and test reports |
