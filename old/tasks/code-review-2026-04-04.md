# DigiLog Full Code Review — 2026-04-04

## Executive Summary

| Area | CRITICAL | HIGH | MEDIUM | LOW | Total |
|------|----------|------|--------|-----|-------|
| Security & Auth | 3 | 6 | 9 | 4 | 22 |
| Business Logic | 1 | 6 | 16 | 7 | 30 |
| Frontend (React) | 2 | 8 | 13 | 7 | 30 |
| Infrastructure | 2 | 9 | 14 | 7 | 32 |
| **TOTAL** | **8** | **29** | **52** | **25** | **114** |

---

## CRITICAL Issues (8) — Fix Immediately

### C1. Audit Trail Deletion Violates 21 CFR Part 11
- **File:** `apps/api/src/modules/audit/routes.ts:199-306`
- DELETE endpoints allow SUPER_ADMIN to permanently delete audit records, bypassing the `audit_trail_no_delete` trigger. This directly violates 21 CFR Part 11 Section 11.10(e) requiring immutable audit trails.
- **Fix:** Remove audit deletion endpoints entirely.

### C2. SUPER_ADMIN Auto-Unlock Bypasses Account Lockout
- **File:** `apps/api/src/modules/auth/auth.service.ts:45-48, 108-117`
- SUPER_ADMIN accounts auto-unlock on every login attempt and are exempt from lockout. Attackers can brute-force with only rate limiting (14,400 attempts/day).
- **Fix:** Subject SUPER_ADMIN to lockout; add separate recovery mechanism.

### C3. SUPER_ADMIN Auto-Recovers from Expired Password
- **File:** `apps/api/src/modules/auth/auth.service.ts:69-71`
- SUPER_ADMIN with EXPIRED status auto-recovers with `forcePasswordChange: false`, completely bypassing password expiry.
- **Fix:** Set `forcePasswordChange: true` on auto-recovery.

### C4. Race Condition in advance() — No Transaction Lock
- **File:** `apps/api/src/modules/filter-operations/filter-operations.service.ts:457-708`
- State validation happens outside the transaction. Two concurrent advance() calls can both pass validation and write conflicting state transitions. Critical for 21 CFR Part 11 data integrity.
- **Fix:** Move state validation inside the `$transaction` block and re-read state within.

### C5. dangerouslySetInnerHTML with Unsanitized Content (XSS)
- **File:** `apps/web/src/routes/config/notification-settings/notification-logs.tsx:199`
- **File:** `apps/web/src/routes/config/notification-rules/index.tsx:931`
- Server HTML rendered directly into DOM without sanitization.
- **Fix:** Use DOMPurify: `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(log.message) }}`

### C6. Duplicate SWR Request Wasting Resources
- **File:** `apps/web/src/routes/filter-management/retirement-list.tsx:7,15`
- Two identical `useSWR` calls to `/api/filters/retirements`; second one (`auditData`) is never used.
- **Fix:** Remove the duplicate useSWR call.

### C7. User.role Has No Foreign Key to Role Table
- **File:** `apps/api/prisma/schema.prisma:193`
- `User.role` is a plain string with no `@relation`. Users can be assigned nonexistent roles. Same issue on `RoleConfig.role`, `Notification.forRole`, `EntityAssignment.roleValue`.
- **Fix:** Add Prisma relation or database-level CHECK constraint.

### C8. AssetInstance/Template Missing Foreign Key to Organization
- **File:** `apps/api/prisma/schema.prisma:478, 418`
- `organizationId` fields declared without `@relation`, no referential integrity for tenant isolation.
- **Fix:** Add proper Prisma relations.

---

## HIGH Issues (29) — Fix Before Next Release

### Security & Auth (6)
| # | Issue | File |
|---|-------|------|
| H1 | Mass assignment — raw body spread to Prisma create/update | `super-admin/routes.ts:104`, `tenant-admin/routes.ts:103,142` |
| H2 | Missing input sanitization on admin routes (stored XSS) | `super-admin/routes.ts`, `tenant-admin/routes.ts`, `org-detail-routes.ts` |
| H3 | Notification bulk ops lack ownership checks | `notifications/routes.ts:93-177` |
| H4 | Missing audit trail for notification rule update/delete | `notification-rules/routes.ts:211-274` |
| H5 | ORG_ADMIN can access other organizations' data | `tenant-admin/org-detail-routes.ts:18-119` |
| H6 | User mass assignment via org-detail user update | `tenant-admin/org-detail-routes.ts:148` |

### Business Logic (6)
| # | Issue | File |
|---|-------|------|
| H7 | Race condition in bypass() — same TOCTOU as advance() | `filter-operations.service.ts:712-776` |
| H8 | replace() not wrapped in transaction — partial failure risk | `filter-operations.service.ts:981-1058` |
| H9 | getEvents/getCycles/getCycleById missing org scoping | `filter-operations.service.ts:779-889` |
| H10 | Cleaning profiles list() loads entire table into memory | `cleaning-profile.service.ts:28-42` |
| H11 | Notification dispatcher fire-and-forget with no persistent retry | `notification-dispatcher.ts:144-201` |
| H12 | Notification retry uses in-process setTimeout (lost on restart) | `delivery.service.ts:93-147` |

### Frontend (8)
| # | Issue | File |
|---|-------|------|
| H13 | Dark theme toast colors in cleaning-profile-editor | `cleaning-profile-editor.tsx:242` |
| H14 | Dark canvas background (#0f0f1a) | `cleaning-profile-editor.tsx:299` |
| H15 | Dark theme badges in filter-scan, filter-profile-list | `filter-scan.tsx:88`, `filter-profile-list.tsx:42` |
| H16 | Dark timeline event backgrounds (900/30) | `timeline.tsx:8,13` |
| H17 | Native alert()/confirm() instead of toast/dialog | `checklists/list.tsx:23-39`, `cleaning-profile-editor.tsx:176` |
| H18 | Dark border-gray-800 in filter-profile-list | `filter-profile-list.tsx:33` |

### Infrastructure (9)
| # | Issue | File |
|---|-------|------|
| H19 | FilterCleaningProfile reuses PmScheduleStatus enum | `schema.prisma:1228` |
| H20 | CleaningCycle.profileId — no relation to FilterCleaningProfile | `schema.prisma:1299` |
| H21 | FilterProfile missing relations on cleaningProfileId, pmScheduleId | `schema.prisma:1279` |
| H22 | Session.tokenHash has no unique constraint | `schema.prisma:236` |
| H23 | Hardcoded default password Admin@123 in seed (no prod guard) | `seed.ts:165` |
| H24 | Hardcoded TSDB credentials in source code | `packages/db/src/tsdb.ts:12-13` |
| H25 | vitest not in package.json dependencies | `apps/api/package.json`, `packages/shared/package.json` |
| H26 | seed.ts `update: {}` means configs never update on re-seed | `seed.ts:308-313` |
| H27 | imports crammed on single lines (merge conflict risk) | `app.ts:59-60,232-233` |

---

## MEDIUM Issues (52)

### Security & Auth (9)
- Roles active endpoint is public (leaks org structure)
- JWT secret falls back to random in non-production
- User stats/list endpoints don't filter by organization
- Audit trail query has no AUDIT_READ permission check
- Uploaded files served without auth
- Binary file serve accepts potentially unsafe paths
- Password in request body for re-auth (logging risk)
- Missing AssetInstance filter field relations in schema

### Business Logic (16)
- advance() doesn't re-validate cycle status inside transaction
- submitChecklist() doesn't validate answers against question schema
- Duplicate orgFilter/orgWhere implementations across modules
- getRetirements/getReplacements ignore org context
- Cleaning profile connection can insert empty string IDs
- validatePipeline() uses index-based validation but updates have UUID IDs
- Filter profile list() has N+1 query problem
- Filter profile update() doesn't validate cleaning profile is active
- Filter profile assign() doesn't validate org membership of targets
- PM schedule createExecution() allows duplicate IN_PROGRESS executions
- PM schedule updateExecution() has no state machine validation
- Rate limiting is per-process, not shared across instances
- processIngestionMessage() silently swallows pipeline failures
- Notification resolveRecipients() adds users twice
- Cooldown map is per-process, not shared
- Config getConfig() returns raw DB value on schema parse failure

### Frontend (13)
- CLEANING_STAGES duplicated in 3 files
- Pervasive use of `any` type (no TypeScript safety)
- Unstable list keys using array index
- Missing loading states in filter-operations
- ChecklistDialog traps user with no cancel button
- Inconsistent dialog backdrop dismiss behavior
- Missing pagination controls in filter-profile-list
- Unreadable subtitle text on gradient dialog headers (3 dialogs)
- Stale closure risk in cleaning-profile-editor delete handler
- ErrorBoundary missing componentDidCatch for logging
- SWR fetcher only logs errors to console (no user feedback)

### Infrastructure (14)
- Missing composite indexes on Notification and AuditTrail
- PasswordResetRequest.userId is VarChar not Uuid
- No min pool size for TSDB connections
- Pool error handler doesn't attempt reconnection
- closeTsdbPool/closeRedisConnection not called in shutdown
- BullMQ using single shared Redis connection
- No Redis reconnect strategy
- Telemetry batcher concurrent flush race condition
- Telemetry batcher unshift can exceed call stack
- Graceful shutdown has no timeout
- Error notification dispatcher could amplify under load
- vite-plugin-pwa not in package.json
- PWA caching API responses (risky for compliance data)
- Version range mismatches across monorepo packages

---

## LOW Issues (25)

### Security (4)
- Error responses leak permission model details
- Pool created per request in binary endpoints
- Shallow sanitization (one level only)
- Roles creatable endpoint allows querying any role

### Business Logic (7)
- computeChecksum not deterministic for JSON serialization
- Cleaning profile create falls back to first org
- SUPER_ADMIN exemption from audit logging in Stage 10
- PM schedule update falls through to empty entries
- PM schedule getByEntity() no org scoping
- Template variables not HTML-escaped in emails
- Duplicate union members in sendTestNotification type

### Frontend (7)
- Unused mutate/apiClient imports
- Missing aria labels on icon buttons
- Hardcoded limit=200 for filter instances
- PM schedule "Create Schedule" button does nothing
- Filter traceability tab styling blends into page
- Inconsistent mutate import styles
- Inconsistent import path aliases

### Infrastructure (7)
- No Prisma logging configuration
- ChecklistReview.checklistId unbounded string
- Missing @@map on some camelCase fields
- Health check doesn't verify DB connectivity
- No sourcemap in Vite build config
- react-router duplicated with react-router-dom
- @types/pg missing from API devDependencies

---

## Top 10 Priorities

| Priority | Issue | Severity | Impact |
|----------|-------|----------|--------|
| 1 | Remove audit trail deletion endpoints | CRITICAL | 21 CFR Part 11 violation |
| 2 | Fix SUPER_ADMIN lockout bypass + password expiry | CRITICAL | Brute force vulnerability |
| 3 | Add transaction locks to advance()/bypass() | CRITICAL | Data integrity race condition |
| 4 | Fix XSS: dangerouslySetInnerHTML + missing sanitization | CRITICAL/HIGH | Security vulnerability |
| 5 | Add org scoping to filter events/cycles/retirements | HIGH | Multi-tenant data leak |
| 6 | Fix mass assignment in admin routes | HIGH | Privilege escalation |
| 7 | Add foreign key constraints to schema | CRITICAL | Referential integrity |
| 8 | Wrap replace() in transaction | HIGH | Data consistency |
| 9 | Fix notification delivery reliability | HIGH | Lost notifications |
| 10 | Remove hardcoded credentials from source | HIGH | Security best practice |

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
