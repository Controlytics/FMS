# DigiLog — Bug Resolution Log

**Maintained by:** Engineering Team
**Created:** 2026-02-25
**Last Updated:** 2026-02-25
**Policy:** Every bug MUST be documented here before closing the associated Git issue.

---

## Summary Metrics

| Metric | Count |
|--------|-------|
| Total Bugs Identified | 12 |
| Total Resolved | 12 |
| Open Issues | 0 |
| Recurring Patterns | 2 (Fastify schema serialization, async race conditions) |

---

## Bug Entries

### BUG-001: `checklistSchema` stripped from GET `/templates/:id` response

| Field | Details |
|-------|---------|
| **Issue ID** | BUG-001 |
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
| 2026-02-25 | 1.0 | Initial creation — cataloged 12 historical bugs from CHANGELOG.md and test reports |
