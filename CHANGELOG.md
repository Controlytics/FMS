# Changelog

All notable changes to DigiLog are documented in this file.

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
