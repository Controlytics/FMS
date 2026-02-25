# DigiLog — Master Development Plan

**Last updated:** 2026-02-25
**Status:** Phase 1 complete, Phase 2 features in progress, refactoring ongoing, documentation governance established

---

## Timeline

| Date | Milestone | Status |
|------|-----------|--------|
| 2026-02-17 | **v1.0.0** — Initial release (User Mgmt, Entity Mgmt, Config, Audit) | Done |
| 2026-02-17 | Action reauth, audit templates, pagination config | Done |
| 2026-02-19 | Dynamic tree diagram, telemetry schema, attach existing, multi-select linking | Done |
| 2026-02-19 | Template linking rules (added then removed) | Done (removed) |
| 2026-02-20 | Connection limits, toast system, Asset→Entity rename, bug fixes | Done |
| 2026-02-20 | API refactoring Phase 0-1 (infrastructure + entity management module) | Done |
| 2026-02-20 | API refactoring Phase 2-4 (auth, config, users modules) | Done |
| 2026-02-21 | Checklist feature, audit descriptions, privileges, reauth, tests | Done |
| 2026-02-25 | **v2.1.1** — Documentation governance, testing centralization, bug log, project summary | Done |
| 2026-02-25 | **v2.1.2** — Git issue lifecycle: 12 bug issues created (#2–#13), 11 closed | Done |
| TBD | API refactoring Phase 5-7 (backup, roles, notifications) | Pending |
| TBD | Frontend refactoring Phase 8-13 | Pending |
| TBD | Future features (e-signatures, logbooks, data ingestion, reports) | Pending |

---

## Completed Work

### Phase 1 — Core Application (v1.0.0)

Full-stack 21 CFR Part 11 compliant digital logbook with:

- **82 API endpoints** across 12 modules (auth, users, roles, config, entity templates, entity instances, entity relationships, entity identifiers, audit, notifications, uploads, backup)
- **28 frontend pages** with role-based access control
- **15 Prisma models** (User, Role, PasswordHistory, Session, PasswordResetRequest, SystemConfig, UserConfig, RoleConfig, FieldIdConfig, AuditTrail, Notification, AssetTemplate, AssetTemplateVersion, AssetInstance, AssetRelationship, AssetIdentifier)
- **9 custom hooks** (useAuth, useReauth, useSession, useSingleTab, useToast, useBranding, useDatetimeFormat, useFieldLabels, usePaginationConfig)
- **Shared package** with Zod schemas, TypeScript types, and constants

### Phase 2 — Entity Management Enhancements

- Connection limits (`maxParentConnections`, `maxConnections`) on templates
- Toast notification system (success/error/warning/info)
- Dynamic tree diagram with create child, attach existing, remove from tree
- Multi-select target linking
- Telemetry schema on templates
- Entity Template view dialog
- Global rename: Asset → Entity (UI only, code identifiers retained)
- Checklist schema (14 question types) on entity templates
- Audit log descriptions for entity operations
- Entity feature privileges and reauth actions

### API Refactoring — Routes → Services → Repositories

| Module | Lines Before | Files After | Status |
|--------|-------------|-------------|--------|
| Phase 0: Infrastructure | — | 5 files (context, errors, build-context, error-schemas, app error handler) | Done |
| Phase 1: Entity Management | 2,088 | 16 files (4 routes, 4 services, 4 repos, 3 helpers, 1 barrel) | Done |
| Phase 2: Users | 1,063 | 3 files (routes, service, repository) | Done |
| Phase 3: Config | 1,048 | 3 files (routes, service, repository) | Done |
| Phase 4: Auth | 834 | 3 files (routes, service, repository) | Done |

### Tests

| Location | Suite | Tests |
|----------|-------|-------|
| `packages/shared` | `schemas/assets.test.ts` | 20 (checklist schema) |
| `packages/shared` | `schemas/auth.test.ts` | Auth schemas |
| `packages/shared` | `schemas/config.test.ts` | Config schemas |
| `packages/shared` | `schemas/users.test.ts` | User schemas |
| `packages/shared` | `types/audit-templates.test.ts` | 17 (audit templates) |
| `apps/api` | `e2e/checklist-templates.test.ts` | 14 (checklist CRUD) |
| `apps/api` | `e2e/entities.test.ts` | Entity E2E |
| `apps/api` | `lib/hash-chain.test.ts` | Hash chain |
| `apps/api` | `lib/jwt.test.ts` | JWT |
| `apps/api` | `lib/password.test.ts` | Password hashing |
| **Total** | | **267 tests (151 shared + 116 API)** |

---

## In Progress

### Recent Changes (2026-02-21) — 5 Groups

**1. Checklist Feature — Entity Templates**
- 14 question types: PASS_FAIL, YES_NO, YES_NO_NA, MCQ, MULTI_SELECT, TEXT, NUMERIC, DROPDOWN, PHOTO, DATE_TIME, SIGNATURE, YES_NO_COMMENT, CALCULATED, CONDITIONAL
- Files: `packages/shared/src/schemas/assets.ts`, `apps/api/src/modules/assets/routes/template.routes.ts`, `apps/api/src/modules/assets/services/template.service.ts`, `apps/web/src/routes/assets/templates.tsx`

**2. Audit Log Descriptions — Entity Management**
- 12 entity actions with descriptive templates and placeholders
- Files: `packages/shared/src/types/audit-templates.ts`, `apps/api/src/plugins/audit-logger.ts`

**3. Privileges & Reauth Configuration**
- 7 entity privileges + 8 entity reauth actions
- Files: `packages/shared/src/types/feature-privileges.ts`, `packages/shared/src/types/reauth-actions.ts`, `apps/web/src/routes/audit/index.tsx`

**4. Unit & E2E Tests**
- 51 new tests across 3 files
- Files: `packages/shared/src/schemas/assets.test.ts`, `packages/shared/src/types/audit-templates.test.ts`, `apps/api/src/e2e/checklist-templates.test.ts`

**5. Bug Fix — GET /templates/:id Response Schema**
- Fixed Fastify stripping `checklistSchema` from responses
- File: `apps/api/src/modules/assets/routes/template.routes.ts`

---

## Pending — API Refactoring (Phases 5-7)

### Phase 5: Backup Module (600 lines → 4 files)

```
modules/backup/
  routes.ts                  -- 3 endpoints
  backup.service.ts          -- orchestrate export/restore/validate
  backup.repository.ts       -- raw SQL queries + Prisma queries
  backup.helpers.ts          -- escapeSqlValue, escapeCsvValue, generateSqlInserts, computeBackupChecksum
```

### Phase 6: Roles Module (541 lines → 3 files)

```
modules/roles/
  routes.ts                  -- 8 endpoints
  role.service.ts            -- CRUD + hierarchy + permissions logic
  role.repository.ts         -- Role Prisma queries
```

### Phase 7: Notifications Module (469 lines → 3 files)

```
modules/notifications/
  routes.ts                  -- 9 endpoints
  notification.service.ts    -- list, mark read/unread, bulk ops + createNotification()
  notification.repository.ts -- Notification Prisma queries
```

Key decision: `createNotification()` moves to `notification.service.ts`. Auth and users services import from notification service.

---

## Pending — Frontend Refactoring (Phases 8-13)

### Phase 8: Frontend Shared Utilities

| Utility | Target File | Currently Duplicated In |
|---------|-------------|------------------------|
| `DEFAULT_PASSWORD_POLICY` + `generatePassword()` | `apps/web/src/lib/password-utils.ts` | users/list, users/create, users/edit, users/reset-requests |
| `useRoleColors()` hook | `apps/web/src/hooks/use-role-colors.ts` | users/list, audit/index, profile, header |
| `getPhotoUrl()` | `apps/web/src/lib/url-utils.ts` | profile, header |

### Phase 9: Entity Explorer (3,227 lines → ~22 files)

```
routes/assets/
  index.tsx                    -- page shell (~180 lines)
  types.ts                     -- TreeNode, AssetTemplate, etc.
  constants.ts                 -- ICON_MAP, RELATIONSHIP_LABELS
  hooks/
    use-entity-mutations.ts    -- all mutation handlers
    use-entity-tree.ts         -- tree filtering, expansion
  components/
    entity-tree-panel.tsx      -- left sidebar tree
    entity-tree-node.tsx       -- recursive tree node
    entity-list-view.tsx       -- table list view
    entity-detail-panel.tsx    -- detail panel with tabs
    attribute-form.tsx         -- dynamic attribute renderer
    float-input.tsx            -- FloatInput component
    hierarchy-diagram.tsx      -- recursive tree diagram
    detail-tabs/
      overview-tab.tsx, attributes-tab.tsx, relationships-tab.tsx,
      identifiers-tab.tsx, audit-history-tab.tsx
    dialogs/
      add-entity-wizard.tsx, edit-entity-dialog.tsx, delete-entity-dialog.tsx,
      link-entities-dialog.tsx, add-identifier-dialog.tsx, attach-existing-dialog.tsx
```

### Phase 10: Entity Template Manager (1,949 lines → ~16 files)

```
routes/assets/
  templates.tsx                -- page shell (~200 lines)
  template-types.ts, template-constants.ts, template-helpers.ts
  hooks/
    use-template-form.ts       -- form state + helpers
  components/
    template-table.tsx, template-form-dialog.tsx, template-view-dialog.tsx,
    template-delete-dialog.tsx, collapsible-section.tsx, numeric-constraints-panel.tsx
    template-form-sections/
      basic-info-section.tsx, attributes-section.tsx, telemetry-section.tsx,
      identifiers-section.tsx, alarm-rules-section.tsx, connection-limits-section.tsx
```

### Phase 11: User List (1,124 lines → ~8 files)

```
routes/users/
  list.tsx                     -- page shell (~200 lines)
  components/
    user-stats-bar.tsx, user-filters.tsx, user-table.tsx,
    user-action-dialog.tsx, user-bulk-delete-dialog.tsx,
    user-unlock-dialog.tsx, user-pagination.tsx
```

### Phase 12: Audit Trail (928 lines → ~7 files)

```
routes/audit/
  index.tsx                    -- page shell (~180 lines)
  audit-helpers.ts             -- ACTION_COLORS, getAuditSummary
  components/
    audit-filters.tsx, audit-table.tsx, audit-detail-modal.tsx,
    audit-pagination.tsx, audit-delete-dialog.tsx
```

### Phase 13: Config Pages (roles 719 lines, branding 644 lines)

```
routes/config/
  roles.tsx + roles-components/ (role-table, role-form-dialog, role-permissions-grid, role-delete-dialog, role-color-picker)
  branding.tsx + branding-components/ (logo-upload-section, color-settings-section, text-settings-section, branding-preview)
```

---

## Future Features (Not Started)

| Feature | Description | Priority |
|---------|-------------|----------|
| Electronic Signatures | E-sign with re-authentication for approvals | High |
| Logbook Entries / Digital Forms | Structured data entry forms tied to entities | High |
| Data Point Ingestion | MQTT/OPC-UA integration for real-time telemetry | Medium |
| Reports & Exports | PDF/Excel reports for audit trail, entity data | Medium |
| HTTPS/TLS Certificates | SSL for production deployment | Medium |
| CI/CD Pipeline | Automated build/test/deploy | Medium |
| Frontend Component Tests | Vitest + React Testing Library for UI components | Low |
| Per-page Pagination Selector | Config page done, page-level integration pending | Low |

---

## Verification Checklist

Run after every change:

```bash
# 1. TypeScript compilation
cd apps/api && npm run build
cd apps/web && npm run build

# 2. Tests
cd packages/shared && npx vitest run     # 151 tests
cd apps/api && npx vitest run            # 116 tests

# 3. Full Turborepo build
npm run build                            # shared → api → web

# 4. Production deploy
pm2 restart digilog-api
```

### Critical Endpoints Per Module
- **Entity Management**: All 21 `/api/assets/*` endpoints
- **Auth**: Login flow, logout, password change
- **Users**: CRUD, enable/disable/unlock, bulk delete
- **Config**: GET/PUT pairs, branding (public), user-id validation

---

## Architecture Principles

1. **Routes → Services → Repositories** — Thin route handlers, business logic in services, DB queries in repositories
2. **RequestContext** — Services receive `{ userId, userSub, userRole, ipAddress, userAgent, sessionId }` instead of Fastify request
3. **AppError hierarchy** — `NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError` caught by global error handler
4. **Reauth in routes** — `enforceReauth()` needs `req`/`reply`, called before service layer
5. **Swagger schemas in routes** — Define the HTTP contract at the route level
6. **Audit logging in services** — Services call standalone `auditLog()` with `RequestContext`
7. **No functionality changes** — Refactoring preserves all API contracts, URLs, request/response formats, HTTP status codes
8. **Shared package as source of truth** — All Zod schemas, types, constants live in `@digilog/shared`

---

## Documentation Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` (root) | Full codebase overview, endpoints, architecture |
| `apps/api/CLAUDE.md` | API-specific patterns and module details |
| `apps/web/CLAUDE.md` | Frontend-specific patterns and component details |
| `packages/shared/CLAUDE.md` | Shared package structure and usage |
| `PLAN.md` | This file — master development plan |
| `BUSINESS_CONTEXT.md` | Business context, regulatory compliance, target industries |
| `CODEBASE_CONTEXT.md` | Codebase context and architecture overview |
| `CHANGELOG.md` | Version history and change details |
| `API_GUIDE.md` | Complete API endpoint reference with examples |
| `task_status.md` | Current development status and progress tracking |
| `apps/api/DECISIONS.md` | API architectural decisions |
| `apps/web/DECISIONS.md` | Frontend architectural decisions |
| `documentation/Bug_Resolution_Log.md` | Structured bug tracking with root cause analysis |
| `documentation/Project_Summary.md` | Comprehensive project summary with metrics |

### Testing Documentation (centralized at `/documentation/testing/`)

| File | Subfolder | Purpose |
|------|-----------|---------|
| `TEST.md` | `manual/` | Comprehensive test summary (334 tests) |
| `TEST_CASES.md` | `manual/` | Test case definitions |
| `TEST_SUMMARY.md` | `manual/` | Test coverage summary |
| `TEST_REPORT.md` | `reports/` | Test execution reports |
| `TREE_DIAGRAM_TEST_REPORT.md` | `reports/` | Tree diagram feature tests (70 tests) |
| `RBAC_TEST_RESULTS.md` | `reports/` | RBAC permission tests (73 tests) |
| `rbac-test.sh` | `automation/` | Automated RBAC test script |
| `21CFR_PART11_VERIFICATION.md` | `validation/` | 21 CFR Part 11 compliance verification |

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-02-25 | Documentation governance: centralized testing docs to `/documentation/testing/`, created Bug_Resolution_Log.md, Project_Summary.md, Git issue template, updated all references | Engineering Team |
| 2026-02-21 | Added checklist feature, audit descriptions, entity privileges, reauth actions, 51 new tests | Engineering Team |
| 2026-02-20 | Phase 2 enhancements, API refactoring phases 0-4, connection limits, toast system | Engineering Team |
| 2026-02-19 | Dynamic tree diagram, telemetry schema, multi-select linking | Engineering Team |
| 2026-02-17 | v1.0.0 initial release, action reauth, audit templates, pagination config | Engineering Team |
