# DigiLog — Bug Resolution Log

**Maintained by:** Engineering Team
**Created:** 2026-02-25
**Last Updated:** 2026-04-04 (Phase 2 Digital FMS Complete)
**Policy:** Every bug MUST be documented here before closing the associated Git issue.

---

## Summary Metrics

| Metric | Count |
|--------|-------|
| Total Bugs Identified | 38+ (28 original + 7 from system validation + 3 new + Phase 2 fixes) |
| Total Resolved | 30+ |
| Open Issues | BUG-012 (low priority) + validation bugs |
| Git Issues Created | 12 (#2-#13) + 30 Phase 2 (#36-#65) |
| Git Issues Closed | 11 + 30 Phase 2 |
| Recurring Patterns | 5 (Fastify schema serialization, async race conditions, ReactFlow custom node handles, UUID type casting, route ordering conflicts) |
| **Platform Stats** | 34 API modules, 57 Prisma models, 17 enums, 23 config definitions |
| **Phase 2** | Digital Filter Management System -- 35 security, logic, and UI fixes in quality audit |

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


---

## FIX-014: OPERATOR Missing "Entities" in Sidebar (OBS-004)

**Date:** 2026-03-01
**Type:** UI Fix
**Severity:** Medium
**Component:** Frontend — Sidebar

**Problem (OBS-004):** OPERATOR role had `ASSET_VIEW` permission but the sidebar did not show the "Entities" navigation item. Users had to manually navigate to `/assets` via URL.

**Root Cause:** The `allNavItems` array in `sidebar.tsx` had `defaultRoles: ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MAINTENANCE']` for the `assets` item — OPERATOR was not included.

**Fix:** Added `'OPERATOR'` to the `defaultRoles` array for the `assets` sidebar item.

**Files Changed:**
- `apps/web/src/components/layout/sidebar.tsx`

**Verification:** Logged in as OPERATOR (RB0001) — "Entities" now appears in sidebar, clicking navigates to Entity Explorer.

---

## FIX-015: Entity Explorer Write Buttons Visible Without Permissions (OBS-005)

**Date:** 2026-03-01
**Type:** Security Fix
**Severity:** High
**Component:** Frontend — Entity Explorer

**Problem (OBS-005):** OPERATOR role (with only `ASSET_VIEW` permission) could see Add Entity, Link Entities, Edit, Link, Delete buttons in the Entity Explorer despite lacking `ASSET_CREATE`, `ASSET_UPDATE`, `ASSET_DELETE`, or `ASSET_RELATIONSHIP_MANAGE` permissions.

**Root Cause:** No permission checks were applied to action buttons in either `index.tsx` (Entity Explorer) or `entity-detail-panel.tsx` (detail panel).

**Fix:** 11 changes across 2 files:
1. Added permission helper flags (`canCreate`, `canUpdate`, `canDelete`, `canManageRelationships`) derived from `user.permissions` in `index.tsx`
2. Wrapped "Add Entity" button with `canCreate` guard
3. Wrapped "Link Entities" button with `canManageRelationships` guard
4. Wrapped tree node "Create child" icon with `canCreate` guard
5. Wrapped tree node "Attach existing" icon with `canManageRelationships` guard
6. Passed permission flags as props to `AssetDetailPanel`
7. Added `canUpdate`, `canDelete`, `canCreate`, `canManageRelationships` to panel interface
8. Destructured permission props with `false` defaults
9. Wrapped "Edit" button with `canUpdate` guard
10. Wrapped "Link" button with `canManageRelationships` guard
11. Wrapped "Delete" button with `canDelete` guard

**Files Changed:**
- `apps/web/src/routes/assets/index.tsx` (6 changes)
- `apps/web/src/routes/assets/components/entity-detail-panel.tsx` (5 changes)

**Verification:** OPERATOR sees no write buttons; SUPER_ADMIN sees all buttons. Backend API already enforced permissions, this fix prevents misleading UI.

---

## FIX-016: Nginx Version Exposed + Missing Security Headers

**Date:** 2026-03-01
**Type:** Security Fix
**Severity:** High
**Component:** Nginx Configuration

**Problem:** HTTP response headers exposed nginx version (`Server: nginx/1.24.0`) and lacked standard security headers (X-Frame-Options, X-Content-Type-Options, etc.).

**Fix:**
1. Uncommented `server_tokens off;` in `/etc/nginx/nginx.conf`
2. Added 5 security headers in `/etc/nginx/sites-enabled/digilog`:
   - `X-Frame-Options: SAMEORIGIN`
   - `X-Content-Type-Options: nosniff`
   - `X-XSS-Protection: 1; mode=block`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

**Files Changed:**
- `/etc/nginx/nginx.conf`
- `/etc/nginx/sites-enabled/digilog`

**Verification:** `curl -sI http://localhost` shows `Server: nginx` (no version) and all 5 headers present.

---

## FIX-017: Rate Limit Bypass via X-Forwarded-For Spoofing

**Date:** 2026-03-01
**Type:** Security Fix
**Severity:** Critical
**Component:** API — Fastify Configuration

**Problem:** `trustProxy: true` allowed attackers to spoof `X-Forwarded-For` headers with arbitrary IPs, bypassing per-IP rate limits on the login endpoint.

**Root Cause:** `trustProxy: true` tells Fastify to trust ALL proxy hops in the X-Forwarded-For chain. An attacker could add a fake IP before nginx's real one.

**Fix:** Changed `trustProxy: true` to `trustProxy: 1` in `apps/api/src/app.ts`. This tells Fastify to trust exactly 1 proxy hop (nginx), reading the real client IP that nginx appends.

**Files Changed:**
- `apps/api/src/app.ts` (line 59)

**Verification:** 12 requests with different `X-Forwarded-For` IPs → rate limit triggered at attempt 11 (10/min limit). Spoofed IPs ignored.

---

## FIX-018: User Enumeration via attemptsRemaining

**Date:** 2026-03-01
**Type:** Security Fix
**Severity:** High
**Component:** API — Auth Service

**Problem:** Login with a non-existent username returned a different error response than login with an existing username + wrong password. The non-existent user response lacked `attemptsRemaining`, allowing attackers to enumerate valid usernames.

**Fix:** In the non-existent user block of `auth.service.ts`, added `attemptsRemaining` to the error response using `maxFailedAttempts` from password policy config. Combined with the existing timing-safe dummy hash comparison, both responses are now indistinguishable.

**Files Changed:**
- `apps/api/src/modules/auth/auth.service.ts`

**Verification:** `POST /api/auth/login` with non-existent user and existing user both return `{"error":"INVALID_CREDENTIALS","message":"Invalid user ID or password.","attemptsRemaining":9}`.

---

## FIX-019: Session Sliding Window

**Date:** 2026-03-01
**Type:** Enhancement
**Severity:** Medium
**Component:** API — Auth Plugin

**Problem:** Session `expiresAt` was set at login time and never extended. Active users could be unexpectedly logged out if their session duration expired even while actively using the app.

**Fix:** In the session validation hook in `auth.plugin.ts`, after updating `lastActiveAt`, also extend `expiresAt` by the configured `sessionDurationHours`. Session config is cached with a 1-minute TTL module-level variable to avoid extra DB reads per request.

**Files Changed:**
- `apps/api/src/plugins/auth.plugin.ts`

**Verification:** Session `expires_at` moved from `18:28:52` to `18:28:57` after a 5-second delay + API call. Active users' sessions keep extending; idle users still expire.

---

## FIX-020: Sessions Not Invalidated on Password Change

**Date:** 2026-03-01
**Type:** Security Fix
**Severity:** Critical
**Component:** API — Auth Service/Repository

**Problem:** Changing a password did not invalidate other active sessions. If an attacker had a stolen session token, it remained valid even after the legitimate user changed their password.

**Fix:**
1. Added `terminateOtherSessions(userId, excludeSessionId, reason)` to `auth.repository.ts`
2. Called it from `changePassword()` in `auth.service.ts` after password update
3. Current session excluded (user isn't logged out after their own password change)
4. Terminated sessions marked with `termination_reason: 'password_changed'`

**Files Changed:**
- `apps/api/src/modules/auth/auth.repository.ts`
- `apps/api/src/modules/auth/auth.service.ts`

**Verification:** Created 2 active sessions for RB0002, changed password, verified: fake session terminated with `password_changed` reason, current session still active (HTTP 200 on /auth/me).

---

## FIX-021: Orphaned Records on Entity Delete

**Date:** 2026-03-01
**Type:** Bug Fix
**Severity:** High
**Component:** API — Instance Service

**Problem:** Deleting an entity left orphaned records in 6 dependent tables: `device_credentials`, `connectivity_status`, `uns_mappings`, `qr_codes`, `latest_telemetry`, `data_streams`. 47 existing orphaned records found from previously deleted entities.

**Fix:**
1. Added `deleteMany` calls for all 6 tables in `instance.service.ts` `delete()` method
2. One-time cleanup SQL script removed 47 existing orphaned records

**Files Changed:**
- `apps/api/src/modules/assets/services/instance.service.ts`

**Verification:** Created entity with telemetry data (device_credentials: 1, connectivity_status: 1, latest_telemetry: 2), deleted entity, verified all dependent tables show 0 records. TSDB data retained for compliance (handled by data retention policies).

---

## FIX-022: UNS Path Fallback Inconsistency

**Date:** 2026-03-01
**Type:** Bug Fix
**Severity:** Medium
**Component:** API — Connectivity Routes, Instance Service

**Problem:** Three code paths used different fallback logic when an entity had no UNS path set:
1. Snippets route: used entity name only
2. Token route: used template/entity
3. Auto-provision: used entity name only

**Fix:** Created `apps/api/src/lib/uns-path.ts` with `getEntityUnsPath(entity)` utility function using consistent fallback: `entity.unsPath ?? templateName/entityName ?? entityName`. Replaced all 3 inconsistent patterns.

**Files Changed:**
- `apps/api/src/lib/uns-path.ts` (new)
- `apps/api/src/modules/connectivity/routes.ts` (2 replacements)
- `apps/api/src/modules/assets/services/instance.service.ts` (1 replacement)

**Verification:** API returns consistent `unsPath: "CCTV/CCTV1"` and `# UNS Path: CCTV/CCTV1` in snippets for entities without explicit UNS paths. Note: Pre-existing credential `allowedTopics` retain old format (data migration not performed).

---

## FIX-023: VIEWER Role RBAC — Entity Explorer Access

**Date:** 2026-03-01
**Type:** Security Fix
**Severity:** High
**Component:** Database — Roles Table

**Problem:** VIEWER role could access the Entity Explorer at `/assets` via direct URL despite the route being wrapped with `<RequireRole permissions={['ASSET_VIEW']}>`. The route guard was working correctly.

**Root Cause:** The `roles` table had `permissions: '["AUDIT_READ", "ASSET_VIEW"]'` for the VIEWER role. Since VIEWER had `ASSET_VIEW` permission, the RequireRole guard passed.

**Fix:** Updated roles table: `UPDATE roles SET permissions = '["AUDIT_READ"]'::jsonb WHERE name = 'VIEWER'`. VIEWER should only have audit access.

**Verification:** Logged in as VIEWER (RB0003), navigated to `/assets` — page shows "Access Denied". Sidebar correctly shows only Dashboard, Notifications, Audit Trail, Alarms.

---

## FIX-024: LatestTelemetry UUID Cast Error

**Date:** 2026-03-07
**Type:** Bug Fix
**Severity:** P0 (Critical)
**Component:** API — Telemetry Queries

**Problem:** `$executeRaw` passed `entity_id` as text to PostgreSQL, but the `latest_telemetry` table column is typed as UUID. PostgreSQL raised a type mismatch error when querying latest telemetry for any entity.

**Root Cause:** Prisma's `$executeRaw` interpolation passed string parameters without explicit UUID casting. PostgreSQL strict type checking rejected the implicit text-to-UUID conversion.

**Fix:** Added explicit `::uuid` cast to the entity_id parameter in the raw SQL query used for latest telemetry lookups.

**Verification:** Queried latest telemetry for entities with active telemetry data — all queries return correct results without type cast errors.

---

## FIX-025: Device Credential `createdAt` Not Updating on Token Regeneration

**Date:** 2026-03-07
**Type:** Bug Fix
**Severity:** P2 (Medium)
**Component:** API — Connectivity / Device Credentials

**Problem:** When regenerating a device access token, the `createdAt` timestamp on the `DeviceCredential` record was not updated. This made it appear that the credential was still from the original creation date, despite having a new token.

**Root Cause:** The token regeneration logic updated the `credentialsValue` (token) and `credentialsHash` fields but did not explicitly set `createdAt` to the current timestamp.

**Fix:** Added `createdAt: new Date()` to the update payload when regenerating device credentials, so the timestamp reflects the most recent token generation.

**Verification:** Regenerated token for a test entity, confirmed `createdAt` now shows the regeneration timestamp rather than the original creation date.

---

## FIX-026: Entity Resolver Cache Never Invalidated

**Date:** 2026-03-07
**Type:** Bug Fix
**Severity:** P3 (Low)
**Component:** API — Data Ingestion / Entity Resolution

**Problem:** The entity resolver used by the data ingestion pipeline cached entity lookups by device credential token, but the cache was never invalidated when entities were updated or deleted. Stale cache entries could persist indefinitely.

**Root Cause:** The in-memory cache had no TTL or invalidation mechanism — entries were stored on first lookup and never refreshed.

**Fix:** Implemented a 30-second TTL on the entity resolver cache. Entries automatically expire after 30 seconds, ensuring that entity updates (renames, deletions, re-assignments) are reflected within a bounded time window.

**Verification:** Confirmed cache entries expire after 30 seconds. Entity renames and deletions are reflected in subsequent data ingestion requests after the TTL window.

---

## FIX-027: SQL/CSV Backup Restore Fails with `Argument displayName is missing`

**Date:** 2026-03-12
**Type:** Bug Fix
**Severity:** High
**Component:** API â Backup & Restore

**Problem:** Restoring SQL or CSV backup files failed with `Argument 'displayName' is missing` error. The restore process could not map raw PostgreSQL column names back to Prisma model fields.

**Root Cause:** SQL and CSV export formats use raw PostgreSQL column names (snake_case), but Prisma expects camelCase field names. The existing `convertDbKeysToPrisma()` only converted table names, not column names within the data.

**Fix:** Added `convertDbColumnsToPrisma()` function with comprehensive COLUMN_MAP (50+ mappings) and STRING_FIELDS type coercion set in `backup.service.ts`. This converts all snake_case database column names to their camelCase Prisma equivalents and coerces numeric strings back to string type where Prisma expects strings.

**Files Changed:**
- `apps/api/src/modules/backup/backup.service.ts`

**Verification:** Successfully restored SQL and CSV backups containing all entity types (users, templates, instances, telemetry, alarms, notification rules). All 50+ column mappings verified.

---

## FIX-028: User Role Reverts to Old Value After Logout

**Date:** 2026-03-12
**Type:** Bug Fix
**Severity:** P0 (Critical)
**Component:** API â Authentication / User Management

**Problem:** When an admin changed a user's role (e.g., OPERATOR â VIEWER), the change appeared to take effect, but after the user logged out and back in, their old role was restored.

**Root Cause:** JWT refresh endpoint copied role from the existing JWT token (`req.user.role`) instead of reading the current role from the database. Admin role changes were never reflected in new tokens. The stale JWT propagated the old role indefinitely through refresh cycles.

**Fix:** Three-pronged approach:
1. **Refresh endpoint** reads role from DB via `prisma.user.findUnique()` instead of copying from stale JWT
2. **Auth plugin** patches `req.user.role` with authoritative DB value on every authenticated request
3. **Session invalidation** â `prisma.session.updateMany()` terminates all user sessions when admin changes role or disables account

**Files Changed:**
- `apps/api/src/modules/auth/routes.ts`
- `apps/api/src/plugins/auth.ts`
- `apps/api/src/modules/users/user.service.ts`

**Verification:** Changed user RB0002 from OPERATOR to VIEWER. Confirmed: (1) immediate API calls use new role, (2) after logout/login new JWT contains VIEWER role, (3) old sessions invalidated with `role_changed` termination reason.

---

## FIX-029: SWR Cache Serving Stale Data Across Pages

**Date:** 2026-03-12
**Type:** Bug Fix
**Severity:** P2 (Medium)
**Component:** Frontend (Global) â SWR Data Fetching

**Problem:** Configuration changes, user updates, and notification rule edits were not reflected in the UI until a full page refresh. Users reported seeing old branding, stale field labels, and outdated user lists after making changes.

**Root Cause:** SWR hooks across 23 files had long `dedupingInterval` (5 minutes for branding, 1 minute for configs) or missing `revalidateOnMount`, causing the SWR cache to serve stale data instead of fetching fresh values when navigating between pages.

**Fix:** Systematic audit of all 27 `useSWR` calls across the frontend. Added `revalidateOnMount: true, dedupingInterval: 0` to ensure fresh data on every page mount. Affected areas:
- Global hooks: branding, field-labels, datetime format, pagination config, reauth config
- All config pages (general, auth, email, MQTT, backup, etc.)
- Notification rules, user management, audit trail

**Files Changed:** 23 files across `apps/web/src/` (hooks, pages, components)

**Verification:** Changed branding settings, navigated away and back â new branding visible immediately without refresh. Changed user role, confirmed user list updates instantly. Modified notification rule, confirmed rules page shows updated data.


## Phase 2 Quality Audit (2026-03-27)

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 36 | CRITICAL | Path traversal in binary file endpoints | Fixed |
| 37 | CRITICAL | Auth double-throw for expired accounts | Fixed |
| 38 | CRITICAL | Config pages return 404 | Fixed |
| 39 | CRITICAL | Empty CHECKLIST node blocks filters | Fixed |
| 40 | CRITICAL | Orphaned stuck IN_PROGRESS cycles | Fixed |
| 41 | HIGH | No org scoping in filter-operations | Fixed |
| 42 | HIGH | Checklist not enforced server-side | Fixed |
| 43 | HIGH | bypass() no cycle check | Fixed |
| 44 | HIGH | Hardcoded TYPE_C reason | Fixed |
| 45 | HIGH | No permission guards on Phase 2 routes | Fixed |
| 46 | HIGH | Missing stages in operations UI | Fixed |
| 47 | MEDIUM | Race condition in startCycle | Fixed |
| 48 | MEDIUM | Race condition in submitChecklist | Fixed |
| 49 | MEDIUM | Profile update no transaction | Fixed |
| 50 | MEDIUM | Missing input sanitization | Fixed |
| 51 | MEDIUM | Pipeline validation incomplete | Fixed |
| 52 | MEDIUM | getCycles performance | Fixed |
| 53-65 | MEDIUM/LOW | Various UI and logic fixes | Fixed |

All tracked as GitHub issues #36-#65, all closed.


---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
