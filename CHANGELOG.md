# Changelog

All notable changes to DigiLog are documented in this file.

## [2.1.0] - 2026-02-16

### Swagger/OpenAPI Full Integration

- **Declarative Route Schemas** — All 55 API routes now include full `schema` definitions (`body`, `params`, `querystring`) using Zod schemas, replacing manual `safeParse()` + 400-response blocks with centralized validation via `fastify-type-provider-zod`.
- **Swagger UI Models** — `/api/docs` now displays request body models, query parameter definitions, and path parameter definitions for every endpoint.
- **Global Zod Error Handler** — Centralized error handler catches Zod validation errors and returns `{ error: 'VALIDATION_ERROR', details: ... }` format, backward-compatible with the existing frontend.
- **24 safeParse blocks removed** — All manual `zodSchema.safeParse(req.body)` + 400 response patterns replaced by declarative schema validation.
- **34 type casts removed** — All `req.params as {...}` and `req.query as {...}` casts replaced by auto-typed parameters from the Zod type provider.

### Backend Changes
- `apps/api/src/app.ts` — Registered `validatorCompiler`, `serializerCompiler`, `jsonSchemaTransform`, and global Zod error handler
- All 10 route files converted to use `ZodTypeProvider` with declarative `schema.body`, `schema.params`, `schema.querystring`

### Shared Package Changes
- Added ~22 new param/query schemas across 9 schema files: `nodeParamsSchema`, `linkParamsSchema`, `hierarchyQuerySchema`, `treeQuerySchema`, `templateQuerySchema`, `templateParamsSchema`, `checklistQuerySchema`, `checklistParamsSchema`, `nodeChecklistParamsSchema`, `recordParamsSchema`, `scheduleParamsSchema`, `scheduleNodeParamsSchema`, `alarmRuleParamsSchema`, `alarmEventsQuerySchema`, `alarmEventParamsSchema`, `auditParamsSchema`, `auditVerifyQuerySchema`, `userParamsSchema`, `fieldIdParamsSchema`, `fieldIdBodySchema`, `verifyBodySchema`
- `packages/shared/src/index.ts` — Exported all new schemas

### Documentation
- `CLAUDE.md` — Added Post-Change Checklist section for CHANGELOG, API_GUIDE, and Swagger sync

---

## [2.0.0] - 2026-02-16

### Asset Module — Full Implementation

#### Phase 1: Asset Relationships
- **Bidirectional Relationship CRUD** — 7 typed relationship pairs (CONTAINS/CONTAINED_IN, CONNECTED_TO/CONNECTED_FROM, FEEDS/FED_BY, DEPENDS_ON/DEPENDED_ON_BY, BACKS_UP/BACKED_UP_BY, MONITORS/MONITORED_BY, CUSTOM/CUSTOM_INVERSE) with auto-inverse creation and transactional consistency.
- **Link validation** — No self-referencing, no duplicates, no circular CONTAINS, decommissioned node rejection.

#### Phase 2: Checklist System
- **Checklist Templates** — 12 question types (PASS_FAIL, MCQ, MULTI_SELECT, FILL_BLANK, DROPDOWN, NUMERIC_WITH_LIMITS, PHOTO, DATE_TIME, SIGNATURE, YES_NO_COMMENT, CALCULATED, CONDITIONAL).
- **3-Tier Approval Workflow** — Performed By → Checked By → Verified By with configurable tiers per template.
- **Segregation of Duties** — Same user cannot perform + check + verify. Enforced at API level.
- **Immutable Records** — SHA-256 checksums on all checklist records. Records cannot be edited once COMPLETED.
- **Status Machine** — DRAFT → SUBMITTED → PENDING_CHECK → PENDING_VERIFY → COMPLETED (or REJECTED at any stage).

#### Phase 3: Schedules
- **Recurring Schedules** — 8 frequency types (HOURLY, PER_SHIFT, DAILY, WEEKLY, MONTHLY, QUARTERLY, ANNUALLY, CUSTOM) with tolerance windows.
- **Onboarding Mode** — First completion sets the anchor date for schedule calculations.
- **Auto-calculation** — `nextDueAt` auto-recalculated after each checklist completion.

#### Phase 4: Enhanced Templates + Asset Creation Wizard
- **Extended Template Schema** — Templates now define checklist schemas, expected identifiers (QR/RFID/Barcode/NFC), expected relationships, default schedules, status lifecycle, and icon URL.
- **7-Step Asset Creation Wizard** — Select Template → Basic Info → Attributes → Telemetry Config → Register Identifiers → Set Schedule → Review & Create.

#### Phase 5: Asset Detail Page + Dual-Panel Explorer
- **8-Tab Asset Detail** — Overview, Attributes (inline editing), Telemetry, Relationships, Checklists & Records, Schedule, Alarms & Deviations, Audit History.
- **Dual-Panel Explorer** — Left panel: collapsible recursive tree (lazy-loaded). Right panel: asset detail tabs. Search and action bar.

#### Phase 6: Alarm System
- **Alarm Rules** — THRESHOLD, CHECKLIST_FIELD, SCHEDULE_MISSED, CUSTOM rule types with configurable severity (INFO, WARNING, ALARM, CRITICAL).
- **Alarm Events** — Lifecycle: OPEN → ACKNOWLEDGED → CLOSED. Auto-triggered by checklist record evaluation.
- **Alarm Rule Builder** — No-code UI for field + operator + value + severity configuration.

#### Phase 7: Delegable Privileges
- **SUPER_ADMIN Delegation** — Grant/revoke asset-related privileges (MANAGE_TEMPLATES, CREATE_INSTANCES, etc.) to any role, optionally scoped to asset types.

### Database Changes
- Enhanced `AssetLink` model with UUID primary key, metadata, and inverseId for bidirectional tracking
- Extended `AssetTemplate` with 7 new fields: checklistSchemas, expectedIdentifiers, expectedRelationships, defaultSchedules, statusLifecycle, iconUrl
- Added 7 new models: `ChecklistTemplate`, `NodeChecklist`, `ChecklistRecord`, `Schedule`, `AlarmRule`, `AlarmEvent`, `DelegatedPrivilege`

### Backend Changes (New API Modules)
- `apps/api/src/modules/checklists/routes.ts` — Template CRUD, node attachment, record submission, check/verify approval, alarm evaluation
- `apps/api/src/modules/schedules/routes.ts` — Schedule CRUD with auto nextDueAt recalculation
- `apps/api/src/modules/alarms/routes.ts` — Alarm rule CRUD, event listing, acknowledge/close lifecycle
- `apps/api/src/modules/privileges/routes.ts` — SUPER_ADMIN-only delegated privilege grant/revoke
- `apps/api/src/modules/hierarchy/routes.ts` — Added link CRUD endpoints (create, list, delete with auto-inverse)
- `apps/api/src/modules/templates/routes.ts` — Handles new template fields (checklists, identifiers, relationships, schedules, lifecycle)
- `apps/api/src/app.ts` — Registered 4 new route modules

### Shared Package Changes
- `packages/shared/src/schemas/relationships.ts` — RELATIONSHIP_TYPES map, getInverseType(), createRelationshipSchema
- `packages/shared/src/schemas/checklists.ts` — 12 question types, template/record/approval schemas
- `packages/shared/src/schemas/schedules.ts` — Frequency types, schedule schemas, calculateNextDue()
- `packages/shared/src/schemas/alarms.ts` — Alarm rule types, severities, config schema
- `packages/shared/src/schemas/templates.ts` — Extended with expectedIdentifiers, expectedRelationships, defaultSchedules, statusLifecycle
- `packages/shared/src/types/audit-actions.ts` — 19 new audit actions across all modules
- `packages/shared/src/index.ts` — Exports for all new schemas and types

### Frontend Changes (New Pages)
- `apps/web/src/routes/assets/explorer.tsx` — Dual-panel explorer with tree + detail view
- `apps/web/src/routes/assets/asset-detail.tsx` — 8-tab standalone asset detail page
- `apps/web/src/routes/assets/checklist-builder.tsx` — Checklist template editor with 12 question types
- `apps/web/src/routes/assets/checklist-execute.tsx` — Fill and submit checklist with per-type input controls
- `apps/web/src/routes/assets/checklist-review.tsx` — Check/Verify approval page with signature trail
- `apps/web/src/routes/assets/record-detail.tsx` — Immutable record viewer with checksum display
- `apps/web/src/routes/config/delegated-privileges.tsx` — SUPER_ADMIN privilege management

### Frontend Changes (New Components)
- `apps/web/src/components/assets/link-dialog.tsx` — Relationship creation dialog
- `apps/web/src/components/assets/asset-tree.tsx` — Recursive lazy-loading tree component
- `apps/web/src/components/assets/schedule-editor.tsx` — Schedule creation dialog
- `apps/web/src/components/assets/schedule-calendar.tsx` — Schedule list with overdue/onboarding badges
- `apps/web/src/components/assets/alarm-rule-builder.tsx` — Alarm rule creation dialog
- 7 tab components in `apps/web/src/components/assets/tabs/` — Overview, Attributes, Relationships, Checklists, Schedule, Alarms, Audit

### Frontend Changes (Modified Pages)
- `apps/web/src/routes/assets/node-create.tsx` — Rewritten as 7-step creation wizard
- `apps/web/src/routes/assets/template-create.tsx` — Rewritten as multi-section editor with identifiers, relationships, lifecycle
- `apps/web/src/routes/assets/template-detail.tsx` — Shows new template fields (identifiers, relationships, lifecycle)
- `apps/web/src/routes/assets/hierarchy.tsx` — Added "+ Link Assets" button and LinkDialog
- `apps/web/src/components/layout/sidebar.tsx` — Added Checklist Builder and Privileges nav items, updated version
- `apps/web/src/main.tsx` — Added all new routes

---

## [1.1.0] - 2026-02-16

### Security & Compliance Fixes

- **Full Password Policy Enforcement** — Change password now validates all policy rules from DB config: minLength, maxLength, uppercase, lowercase, numbers, special characters, cannot be/contain user ID. Returns specific error messages per violation.
- **Password Expiration Enforcement** — Login now checks `passwordExpiresAt`. Expired passwords force password change. Successful password change sets expiration to 90 days.
- **Audit Checksum Verification** — New `GET /api/audit/:id/verify` and `GET /api/audit/verify` endpoints to verify SHA-256 checksum integrity of audit trail records.
- **Configurable Re-authentication** — SUPER_ADMIN can configure which sensitive operations (config changes, user management, node create/delete) require password re-entry. Backend validates via `X-Verification-Token` header. Frontend shows password dialog when needed.
- **Audit Logging for Identifiers** — Physical identifier creation now generates `NODE_IDENTIFIER_ADDED` audit trail entry.
- **Audit Write Error Handling** — Audit trail write failures now block the parent operation and log the error, ensuring no unaudited mutations occur.

### Features

- **Swagger / OpenAPI Documentation** — Interactive API docs available at `/api/docs`. All routes annotated with tags, summaries, and descriptions.
- **Re-authentication Settings Page** — New `/config/reauth-settings` page for SUPER_ADMIN to configure which operations require password re-entry via checkboxes.
- **API Guide** — Comprehensive `API_GUIDE.md` documenting all endpoints with methods, auth requirements, request/response schemas, and query parameters.

### Backend Changes

- `apps/api/src/modules/auth/routes.ts` — Added `validatePasswordPolicy()` helper, password expiration check on login, 90-day expiry on password change
- `apps/api/src/plugins/audit-logger.ts` — Added try/catch with error logging and re-throw on audit write failure
- `apps/api/src/modules/audit/routes.ts` — Added checksum verification endpoints (single + bulk)
- `apps/api/src/plugins/rbac.ts` — Added `requireReauth()` decorator that checks DB config and validates verification token
- `apps/api/src/modules/config/routes.ts` — Added `GET/PUT /api/config/reauth-settings`, applied reauth middleware to config PUT endpoints
- `apps/api/src/modules/users/routes.ts` — Applied `requireReauth` to create, update, delete, enable, disable, reset-password
- `apps/api/src/modules/hierarchy/routes.ts` — Applied `requireReauth` to create/delete, added audit log for identifier creation
- `apps/api/src/modules/templates/routes.ts` — Added Swagger schema annotations
- `apps/api/src/app.ts` — Registered `@fastify/swagger` and `@fastify/swagger-ui`
- `packages/shared/src/schemas/config.ts` — Added `reauthConfigSchema`, `ALL_REAUTH_OPERATIONS`
- `packages/shared/src/types/audit-actions.ts` — Added `NODE_IDENTIFIER_ADDED`, `REAUTH_SETTINGS_CHANGED`

### Frontend Changes

- `apps/web/src/components/ui/reauth-dialog.tsx` — New re-authentication password dialog component
- `apps/web/src/hooks/use-reauth.ts` — New `useReauth()` hook with `executeWithReauth()` pattern
- `apps/web/src/lib/api-client.ts` — Added optional `headers` parameter to all HTTP methods
- `apps/web/src/routes/config/reauth-settings.tsx` — New SUPER_ADMIN settings page for re-auth operations
- `apps/web/src/routes/config/index.tsx` — Added re-authentication settings card
- `apps/web/src/routes/config/password-policy.tsx` — Wrapped submit with reauth
- `apps/web/src/routes/config/login-security.tsx` — Wrapped submit with reauth
- `apps/web/src/routes/config/session.tsx` — Wrapped submit with reauth
- `apps/web/src/routes/users/create.tsx` — Wrapped submit with reauth
- `apps/web/src/routes/users/list.tsx` — Wrapped user actions with reauth
- `apps/web/src/main.tsx` — Added `/config/reauth-settings` route

## [1.0.0] - 2026-02-14

### Initial Release

- User Management (CRUD, roles, password policies, lockout)
- Asset Management (hierarchy, templates, versioning)
- Audit Trail with SHA-256 checksums
- 21 CFR Part 11 compliance (electronic signatures, secure password fields)
- Session management with auto-logout
- Role-based access control (SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER)
