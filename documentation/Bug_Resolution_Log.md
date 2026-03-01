# DigiLog — Bug Resolution Log

**Maintained by:** Engineering Team
**Created:** 2026-02-25
**Last Updated:** 2026-02-27 (v2.1.3)
**Policy:** Every bug MUST be documented here before closing the associated Git issue.

---

## Summary Metrics

| Metric | Count |
|--------|-------|
| Total Bugs Identified | 15 |
| Total Resolved | 14 |
| Open Issues | 1 (BUG-012, low priority) |
| Git Issues Created | 12 (#2–#13) |
| Git Issues Closed | 11 |
| Recurring Patterns | 3 (Fastify schema serialization, async race conditions, ReactFlow custom node handles) |

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
| **Git Issue** | [#13](https://github.com/pankajexa/21cfrlogbook/issues/13) (open) |
| **Bug Title** | E2E test expects `INVALID_CREDENTIALS` but gets `Unauthorized` |
| **Date Identified** | 2026-02-17 |
| **Module** | Authentication |
| **Severity** | LOW |
| **Root Cause Analysis** | `auth.test.ts` E2E test `returns 401 for non-existent user` expects the response body to contain error code `INVALID_CREDENTIALS`, but the Fastify error handler returns the generic `Unauthorized` message. |
| **Technical Explanation** | The login route throws `reply.unauthorized()` (Fastify sensible plugin) which produces `{ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' }`. The test expects a custom `code` field with value `INVALID_CREDENTIALS` which was never implemented. This is a test expectation mismatch, not a functional bug. |
| **Code-Level Fix** | Pending — requires either updating the test expectation or adding custom error codes to the login failure response. |
| **Preventive Measures** | E2E tests should match actual API behavior. Review test expectations against implementation during test creation. |
| **Testing Done** | Pre-existing. 333/334 tests pass. This single failure is isolated and does not affect functionality. |
| **Resolution Date** | Open (low priority) |
| **Linked Commit** | N/A |
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

---

## Version History

| Date | Version | Change |
|------|---------|--------|
| 2026-02-25 | 1.1 | Git issue lifecycle: created 12 GitHub issues (#2–#13), closed 11, linked all entries |
| 2026-02-25 | 1.0 | Initial creation — cataloged 12 historical bugs from CHANGELOG.md and test reports |

---

## BUG-013: RBAC Permission Mismatch - _MANAGE vs Granular Permissions

**Date Found:** 2026-02-27  
**Severity:** Critical  
**Status:** RESOLVED  

### Description
Template routes enforced granular permissions (`ASSET_TEMPLATE_CREATE`, `ASSET_TEMPLATE_UPDATE`, `ASSET_TEMPLATE_DELETE`) but database roles only stored the coarse `ASSET_TEMPLATE_MANAGE` permission. This caused non-SUPER_ADMIN roles (like ADMIN) to be denied template management operations even though they should have access. SUPER_ADMIN was unaffected because it bypasses all permission checks.

### Root Cause
The `requirePermission()` check in `rbac.ts` used a simple `Array.includes()` match — no hierarchy or parent-permission resolution. When checking for `ASSET_TEMPLATE_CREATE`, it did not recognize that `ASSET_TEMPLATE_MANAGE` should grant that access.

### Fix Applied
Updated `apps/api/src/plugins/rbac.ts` to support permission hierarchy: when a granular permission check fails (e.g., `ASSET_TEMPLATE_CREATE`), the plugin now checks if the user has the corresponding `*_MANAGE` parent permission. Supported suffixes: `_CREATE`, `_UPDATE`, `_DELETE`, `_VIEW`, `_READ`, `_EXPORT`.

### Files Changed
- `apps/api/src/plugins/rbac.ts` — Added `_MANAGE` hierarchy resolution before permission denial

### Verification
- ADMIN role (with `ASSET_TEMPLATE_MANAGE`) can now CREATE, UPDATE, and DELETE templates
- OPERATOR and VIEWER roles (without template permissions) are correctly denied
- SUPER_ADMIN continues to bypass all checks
- All existing direct permission matches continue to work

---

## BUG-014: Template category field accepts any string value
**Date:** 2026-02-27  
**Severity:** Medium  
**Found by:** API Tester Agent  

### Symptom
The template creation/update endpoints accepted any string for the `category` field, allowing invalid values like "INVALID" or inconsistent casing ("EQUIPMENT" vs "Equipment").

### Root Cause
The Zod schema in `packages/shared/src/schemas/assets.ts` defined `category` as `z.string().max(50)` — no enum constraint. The Fastify route schema similarly had `{ type: 'string' }` with no `enum` property.

### Fix
1. Added `TEMPLATE_CATEGORIES` enum constant: General, Equipment, Room, Building, Sensor, Vehicle, Utility, Process, Storage, Laboratory
2. Updated Zod schema: `z.enum(TEMPLATE_CATEGORIES).default('General')`
3. Updated Fastify route body schema with matching `enum` array
4. Exported `TEMPLATE_CATEGORIES` from `@digilog/shared`
5. Cleaned existing DB data: normalized "EQUIPMENT"→"Equipment", "INVALID"→"General", "Testing"→"General"

### Files Changed
- `packages/shared/src/schemas/assets.ts` — Added TEMPLATE_CATEGORIES, updated Zod schema
- `packages/shared/src/index.ts` — Exported TEMPLATE_CATEGORIES
- `apps/api/src/modules/assets/routes/template.routes.ts` — Added enum to route body schema

### Verification
- POST with `category: "INVALID_CATEGORY"` returns 400 VALIDATION_ERROR with allowed values list
- POST with `category: "Equipment"` succeeds
- All existing templates have valid categories

---

## BUG-015: Rule Chain Editor — Missing Node Connection Handles

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-015 |
| **Git Issue** | Pending |
| **Bug Title** | Rule chain editor nodes have no connection handles — cannot create edges between nodes |
| **Date Identified** | 2026-02-27 |
| **Module** | Rule Chain — Visual Editor |
| **Severity** | HIGH |
| **Root Cause Analysis** | The  component in  did not render ReactFlow  components. Without handles, users had no connection points to drag edges between nodes, completely blocking the visual rule chain editing workflow. |
| **Technical Explanation** | ReactFlow only auto-renders connection handles on its built-in default node type. When a custom node component is registered via , ReactFlow expects the component to explicitly render  and  components. The  had a comment saying React Flow handles rendered by ReactFlow itself — we position them via CSS which was incorrect. Neither  nor  were imported from the  package. The  handler, , and backend  endpoint were all implemented and functional — the only missing piece was the visual handle elements on the nodes. |
| **Code-Level Fix** | (1) Added  and  to the  import statement. (2) Added  and  inside the  component, with Tailwind classes for sizing (), colors (), borders (), hover states ( for target,  for source), and positioning (, ). |
| **Preventive Measures** | When creating custom ReactFlow node components, always include explicit  components — ReactFlow does not auto-render them for custom nodes. Added to development checklist. |
| **Testing Done** | (1) Integration Expert: 11-endpoint post-build smoke test — all PASS. (2) API Tester: Full rule chain connection workflow (create chain → add nodes → create connection → verify → delete) — all PASS, 31 node types confirmed. (3) Manual Tester: Live Playwright browser test — nodes visible with handles, drag-to-connect triggers Create Connection dialog, labeled edge (True) rendered with arrow between Filter Messages → Save Data nodes. (4) Test chain cleaned up after verification. |
| **Resolution Date** | 2026-02-27 |
| **Linked Commit** | Pending |
| **Linked PR** | N/A |

### Recurring Pattern: ReactFlow Custom Node Handles

**Bugs Affected:** BUG-015

**Pattern:** ReactFlow's default node type auto-renders connection handles, but custom node components registered via \ must explicitly include \ components. A comment in the code incorrectly stated ReactFlow would render handles automatically, leading to a completely non-functional connection UI despite all backend and frontend connection logic being implemented.

**Prevention:** Always verify custom ReactFlow nodes include \ and \. Test drag-to-connect immediately after creating custom node components.


---

## BUG-016: Rule Engine msg-type-filter Default Mismatch

| Field | Value |
|-------|-------|
| **Bug ID** | BUG-016 |
| **Bug Title** | Rule engine msg-type-filter node uses TELEMETRY but actual messageType is POST_TELEMETRY |
| **Date Identified** | 2026-02-27 |
| **Module** | Rule Engine — Node Execution |
| **Severity** | MEDIUM |
| **Root Cause Analysis** | The msg-type-filter node was configured with messageTypes: ["TELEMETRY"] but the message normalizer sets _messageType to "POST_TELEMETRY" for telemetry ingestion messages. This mismatch caused the filter to never pass telemetry messages through, preventing rule chain alarm creation. |
| **Code-Level Fix** | Updated rule chain node config to include both "POST_TELEMETRY" and "TELEMETRY" in the messageTypes array. Saved as rule chain v3. |
| **Resolution Date** | 2026-02-27 |

---

## BUG-017: Frontend Alarm Page Sends Wrong Field Name for Electronic Signature

| Field | Value |
|-------|-------|
| **Bug ID** | BUG-017 |
| **Bug Title** | Alarm acknowledge/clear sends signerName instead of signerFullName in request body |
| **Date Identified** | 2026-02-27 |
| **Module** | Frontend — Alarm Dashboard (apps/web/src/routes/alarms/index.tsx) |
| **Severity** | HIGH |
| **Root Cause Analysis** | The frontend alarm page line 169 sent the field as signerName in the POST body, but the API schema requires signerFullName. This caused a 400 validation error: body must have required property signerFullName. |
| **Code-Level Fix** | Changed request body key from signerName to signerFullName in apps/web/src/routes/alarms/index.tsx line 169. The React state variable remains signerName (internal only). |
| **Resolution Date** | 2026-02-27 |

---

## BUG-018: Backend Alarm Routes Use Wrong JWT Field for User ID

| Field | Value |
|-------|-------|
| **Bug ID** | BUG-018 |
| **Bug Title** | alarm.routes.ts uses user.id but JWT payload contains user.sub for user ID |
| **Date Identified** | 2026-02-27 |
| **Module** | Backend — Alarm Routes (apps/api/src/modules/queries/alarm.routes.ts) |
| **Severity** | HIGH |
| **Root Cause Analysis** | The acknowledge and clear handlers in alarm.routes.ts referenced user.id for signerUserId and hash computation, but the JWT payload structure uses sub for the user UUID (per jwt.ts). This caused signerUserId is missing errors since user.id was undefined. Also used user.id for acknowledgedBy/clearedBy display names instead of user.username. |
| **Code-Level Fix** | (1) Changed type annotation from { id: string } to { sub: string }. (2) Changed user.id to user.sub for signerUserId and hash computation. (3) Changed user.id to user.username for acknowledgedBy/clearedBy display fields. Applied to both acknowledge (line 265-304) and clear (line 350-395) handlers. |
| **Resolution Date** | 2026-02-27 |


---

## Observations (Non-Blocking)

### OBS-001: Data Retention Deletions Not Logged in Audit Trail
- **Observed:** 2026-02-28
- **Severity:** Low (Observation)
- **Description:** When Delete Data operations (telemetry or attributes) are performed via the Entity Explorer, the deletion is not recorded in the audit_trail table. While the operation succeeds correctly, there is no audit entry capturing who deleted what data and when.
- **Recommendation:** Add an audit trail entry for all data retention/deletion operations to maintain full compliance with 21 CFR Part 11 requirements.

### OBS-002: Entity Explorer Accessible to Operator via Direct URL
- **Observed:** 2026-02-28
- **Severity:** Low (Observation)
- **Description:** The Entity Explorer page is accessible to Operator role users when navigating directly via URL. While the API correctly enforces RBAC (returning 403 for unauthorized actions), the UI does not hide action buttons (e.g., Delete Data) for non-admin users, which could cause confusion.
- **Recommendation:** Hide or disable action buttons in Entity Explorer UI for users without the required permissions. Consider restricting direct URL access to the page for non-admin roles.

---

## OBS-003: Duplicate maxFailedAttempts Config Keys

**Date:** 2026-02-28
**Type:** Observation (Non-Blocking)
**Severity:** Medium
**Component:** Configuration (login-security vs password-policy)

**Description:** The system stores `maxFailedAttempts` in two separate config keys:
- `login-security.maxFailedAttempts` -- Used by the actual lockout logic in `auth.service.ts`
- `password-policy.maxFailedAttempts` -- Stored but NOT used for lockout enforcement

**Impact:** Changing maxFailedAttempts in the password-policy UI does NOT affect actual lockout behavior. Both config keys must be updated together.

**Recommendation:** Consolidate into a single config key, or have the auth service read from `password-policy` for all settings.

---

## FIX-001: SUPER_ADMIN Account Protection

**Date:** 2026-02-28
**Type:** Security Enhancement
**Severity:** High
**Component:** `apps/api/src/modules/auth/auth.service.ts`

**Problem:** SUPER_ADMIN accounts had no exemptions from lockout or password expiry. The default admin account (`admin/Admin@123`) could be locked out after 5 wrong attempts, creating a recovery problem.

**Fix:** Applied 4 patches to `auth.service.ts`:
1. SUPER_ADMIN never increments `failedLoginAttempts` on wrong password
2. SUPER_ADMIN auto-unlocks if status is LOCKED
3. SUPER_ADMIN password expiry does not trigger `forcePasswordChange`
4. SUPER_ADMIN auto-recovers from EXPIRED status

**Verification:** 6 consecutive wrong passwords for admin -- never locked. Correct password accepted immediately after. Non-admin accounts still properly locked.

---

## FIX-002: Consolidate maxFailedAttempts into Password Policy

**Date:** 2026-02-28
**Type:** Bug Fix
**Severity:** High
**Component:** Auth Service, Config Schemas, Frontend

**Problem (OBS-003):** maxFailedAttempts was stored in two separate config keys (password-policy and login-security). The auth service only read from login-security, so changes made on the Password Policy UI page had no effect on actual lockout behavior. Admins could set maxFailedAttempts=3 on the Password Policy page but accounts would still lock at 5.

**Fix:** 6 changes applied:
1. Shared schema: Removed maxFailedAttempts from loginSecuritySchema
2. Auth service: Changed to read maxFailedAttempts from getPasswordPolicyConfig()
3. Auth repository: Removed maxFailedAttempts from getLoginSecurityConfig() return type
4. Frontend: Removed maxFailedAttempts field from Login Security page
5. Seed file: Removed maxFailedAttempts from login-security default
6. Database: Removed maxFailedAttempts from existing login-security config value
7. Test file: Updated loginSecuritySchema tests

**Verification:** Set maxFailedAttempts=3 via Password Policy UI, tested with RB0003 -- account locked after exactly 3 wrong attempts (previously required 5). Restored to default (5), reset RB0003.

---

### FIX-003: Standalone Checklist QR Form
**Date:** 2026-02-28
**Severity:** Medium
**Category:** UX / Data / API

**Problem:** QR code for entity checklist opens full application UI (sidebar + header) instead of a clean standalone form. Additionally, checklist questions don't render due to missing `checklistSchema` in API response, schema format mismatch, and submit payload format mismatch.

**Root Causes:**
1. `/checklist/:entityId` route nested inside `<AppLayout>` wrapper
2. `instance.repository.ts` `findById` doesn't select `checklistSchema` from template
3. DB stores checklist as flat array `[{question, questionType}]` but component expects `{questions: [{id, label, type}]}`
4. Frontend sends `answers` (array) but API expects `responses` (flat object)

**Fix:**
1. Moved route outside `<AppLayout>` in `main.tsx` for standalone rendering
2. Added `checklistSchema: true` to Prisma template select in `instance.repository.ts`
3. Normalized schema extraction in `checklist/index.tsx` to handle both formats
4. Fixed submit payload from `answers` array to `responses` flat object

**Files Changed:**
- `apps/web/src/main.tsx`
- `apps/api/src/modules/assets/repositories/instance.repository.ts`
- `apps/web/src/routes/checklist/index.tsx` (2 patches)

**Verification:** Browser test — standalone form renders, 5 questions load, submit succeeds with "Checklist Submitted" confirmation.

---

### FIX-004: Checklist Submission History
**Date:** 2026-02-28
**Severity:** Medium
**Category:** Feature / Data / UX

**Problem:** Checklist page had no way to view previously submitted checklists. Additionally, the `ts_checklist_responses` TSDB table was never created, so all checklist submissions were silently failing in the BullMQ worker.

**Root Causes:**
1. `ts_checklist_responses` table missing from database (DDL in init-tsdb.sql never executed)
2. No time-range query endpoint for checklist history
3. Retention delete system didn't support `checklists` data type

**Fix:**
1. Created `ts_checklist_responses` table + indexes in PostgreSQL
2. Added `GET /checklist/:entityId/history?from=&to=&limit=` endpoint (TSDB + PG join)
3. Added `checklists` to retention delete types with dual PG+TSDB cleanup
4. Added `ChecklistHistory` component to checklist page: time range selector, table, expandable rows, pagination, admin-only delete dialog

**Files Changed:**
- `apps/api/src/modules/queries/telemetry.routes.ts` (new history endpoint)
- `apps/api/src/modules/queries/retention.routes.ts` (delete support)
- `apps/web/src/routes/checklist/index.tsx` (history UI)

**Verification:** Browser test — submit checklist, history table shows submission, expandable rows show answers, delete removes from both TSDB + PG.
