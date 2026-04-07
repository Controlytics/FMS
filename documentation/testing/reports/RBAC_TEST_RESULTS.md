# DigiLog RBAC Test Results

**Date:** 2026-02-23 10:29:39 UTC (original run), last verified 2026-04-04
**Tester:** Automated Script (rbac-test.sh)
**Test Role:** `RBAC_TEST` (hierarchy level 1, custom role)
**Test User:** `999999`
**API Base:** http://localhost:3000
**Note (2026-04-04):** All 73 core RBAC tests continue to pass. Phase 2 adds 17 filter management permissions. Permission migration to `requirePermission()` (from `requireRole()`) completed across all modules. RBAC architecture remains stable with 52+ granular permissions across 10+ categories.

---

## Summary

| Metric | Count |
|--------|-------|
| **Total Core Tests** | 73 |
| **Passed** | 73 |
| **Failed** | 0 |
| **Pass Rate** | **100.0%** |

---

## Detailed Test Results

| ID | Category | Permission | Test Description | Expected | Actual | Status |
|----|----------|-----------|------------------|----------|--------|--------|
| A01 | Baseline | `none` | GET /users -- denied | 403 | HTTP 403 | **PASS** |
| A02 | Baseline | `none` | GET /audit -- any auth (by design) | 200 | HTTP 200 | **PASS** |
| A03 | Baseline | `none` | GET /config/password-policy -- denied | 403 | HTTP 403 | **PASS** |
| A04 | Baseline | `none` | GET /assets/instances -- denied | 403 | HTTP 403 | **PASS** |
| A05 | Baseline | `none` | GET /assets/templates -- denied | 403 | HTTP 403 | **PASS** |
| A06 | Baseline | `none` | GET /notifications -- any auth (by design) | 200 | HTTP 200 | **PASS** |
| A07 | Baseline | `none` | GET /config/my-config -- always allowed | 200 | HTTP 200 | **PASS** |
| A08 | Baseline | `none` | GET /auth/me -- always allowed | 200 | HTTP 200 | **PASS** |
| A09 | Baseline | `none` | Sidebar empty with no perms | 0 | 0 items | **PASS** |
| B01 | Users | `users.view` | GET /users -- allowed | 200 | HTTP 200 | **PASS** |
| B02 | Users | `users.view` | GET /users/stats -- allowed | 200 | HTTP 200 | **PASS** |
| B03 | Users | `users.view` | my-config users.view=true | true | true | **PASS** |
| B04 | Users | `users.view` | Sidebar has users | users | users | **PASS** |
| B05 | Users | `users.create` | my-config users.create=true | true | true | **PASS** |
| B06 | Users | `users.edit` | my-config users.edit=true | true | true | **PASS** |
| B07 | Users | `users.delete` | my-config users.delete=true | true | true | **PASS** |
| B08 | Users | `users.reset_password` | my-config users.reset_password=true | true | true | **PASS** |
| B09 | Users | `users.unlock` | my-config users.unlock=true | true | true | **PASS** |
| B10 | Users | `users.enable_disable` | my-config users.enable_disable=true | true | true | **PASS** |
| C01 | System | `config.view` | GET /config/password-policy -- allowed | 200 | HTTP 200 | **PASS** |
| C02 | System | `config.view` | GET /config/datetime -- allowed | 200 | HTTP 200 | **PASS** |
| C03 | System | `config.view` | GET /config/session -- allowed | 200 | HTTP 200 | **PASS** |
| C04 | System | `config.view` | GET /assets/instances -- denied (no asset perm) | 403 | HTTP 403 | **PASS** |
| C05 | System | `config.view` | my-config config.view=true | true | true | **PASS** |
| C06 | System | `config.view` | Sidebar has configuration | configuration | configuration | **PASS** |
| C07 | System | `config.edit` | my-config config.edit=true | true | true | **PASS** |
| C08 | System | `audit.view` | GET /audit -- allowed | 200 | HTTP 200 | **PASS** |
| C09 | System | `audit.view` | my-config audit.view=true | true | true | **PASS** |
| C10 | System | `audit.view` | Sidebar has audit | audit | audit | **PASS** |
| C11 | System | `audit.export` | my-config audit.export=true | true | true | **PASS** |
| C12 | System | `notifications.manage` | GET /notifications -- allowed | 200 | HTTP 200 | **PASS** |
| C13 | System | `notifications.manage` | my-config notifications.manage=true | true | true | **PASS** |
| C14 | System | `notifications.manage` | Sidebar has notifications | notifications | notifications | **PASS** |
| D01 | Entity | `assets.view` | GET /assets/instances -- allowed | 200 | HTTP 200 | **PASS** |
| D02 | Entity | `assets.view` | GET /assets/instances/tree -- allowed | 200 | HTTP 200 | **PASS** |
| D03 | Entity | `assets.view` | GET /assets/relationships -- allowed | 200 | HTTP 200 | **PASS** |
| D04 | Entity | `assets.view` | GET /assets/identifiers -- allowed | 200 | HTTP 200 | **PASS** |
| D05 | Entity | `assets.view` | GET /assets/templates -- denied (no template perm) | 403 | HTTP 403 | **PASS** |
| D06 | Entity | `assets.view` | my-config assets.view=true | true | true | **PASS** |
| D07 | Entity | `assets.view` | Sidebar has assets | assets | assets | **PASS** |
| D08 | Entity | `assets.create` | GET /assets/instances -- denied (no view) | 403 | HTTP 403 | **PASS** |
| D09 | Entity | `assets.create` | my-config assets.create=true | true | true | **PASS** |
| D10 | Entity | `assets.edit` | my-config assets.edit=true | true | true | **PASS** |
| D11 | Entity | `assets.delete` | my-config assets.delete=true | true | true | **PASS** |
| D12 | Entity | `assets.relationships` | my-config assets.relationships=true | true | true | **PASS** |
| D13 | Entity | `assets.identifiers` | my-config assets.identifiers=true | true | true | **PASS** |
| E01 | Templates | `assets.templates_view` | GET /assets/templates -- allowed | 200 | HTTP 200 | **PASS** |
| E02 | Templates | `assets.templates_view` | POST /assets/templates -- denied | 403 | HTTP 403 | **PASS** |
| E03 | Templates | `assets.templates_view` | my-config assets.templates_view=true | true | true | **PASS** |
| E04 | Templates | `assets.templates_view` | Sidebar has asset-templates | asset-templates | asset-templates | **PASS** |
| E05 | Templates | `assets.templates_create` | GET /assets/templates -- denied (no view) | 403 | HTTP 403 | **PASS** |
| E06 | Templates | `assets.templates_create` | my-config assets.templates_create=true | true | true | **PASS** |
| E07 | Templates | `assets.templates_edit` | my-config assets.templates_edit=true | true | true | **PASS** |
| E08 | Templates | `assets.templates_delete` | my-config assets.templates_delete=true | true | true | **PASS** |
| F01 | Isolation | `assets.view` | GET /assets/instances -- allowed | 200 | HTTP 200 | **PASS** |
| F02 | Isolation | `assets.view` | GET /assets/templates -- denied | 403 | HTTP 403 | **PASS** |
| F03 | Isolation | `audit.view` | GET /audit -- allowed | 200 | HTTP 200 | **PASS** |
| F04 | Isolation | `audit.view` | GET /assets/instances -- denied | 403 | HTTP 403 | **PASS** |
| F05 | Isolation | `multi` | GET /assets/instances -- allowed | 200 | HTTP 200 | **PASS** |
| F06 | Isolation | `multi` | GET /audit -- allowed | 200 | HTTP 200 | **PASS** |
| F07 | Isolation | `multi` | GET /config/password-policy -- allowed | 200 | HTTP 200 | **PASS** |
| F08 | Isolation | `multi` | POST /assets/instances -- denied (no create) | 403 | HTTP 403 | **PASS** |
| F09 | Isolation | `multi` | my-config has exactly 3 true perms | 3 | 3 | **PASS** |
| G01 | SA Bypass | `SUPER_ADMIN` | GET /users | 200 | HTTP 200 | **PASS** |
| G02 | SA Bypass | `SUPER_ADMIN` | GET /audit | 200 | HTTP 200 | **PASS** |
| G03 | SA Bypass | `SUPER_ADMIN` | GET /assets/instances | 200 | HTTP 200 | **PASS** |
| G04 | SA Bypass | `SUPER_ADMIN` | GET /assets/templates | 200 | HTTP 200 | **PASS** |
| G05 | SA Bypass | `SUPER_ADMIN` | GET /config/password-policy | 200 | HTTP 200 | **PASS** |
| G06 | SA Bypass | `SUPER_ADMIN` | GET /notifications | 200 | HTTP 200 | **PASS** |
| G07 | SA Bypass | `SUPER_ADMIN` | GET /roles | 200 | HTTP 200 | **PASS** |
| H01 | Passthrough | `ASSET_VIEW` | GET /users -- allowed (any perm = pass) | 200 | HTTP 200 | **PASS** |
| H02 | Passthrough | `ASSET_VIEW` | GET /config -- allowed (any perm = pass) | 200 | HTTP 200 | **PASS** |
| H03 | Passthrough | `ASSET_VIEW` | GET /templates -- denied (wrong perm) | 403 | HTTP 403 | **PASS** |

---

## Test Group Descriptions

### Group A: Zero Permissions Baseline (9 tests)
Validates behavior when test role has NO permissions. Protected endpoints deny access.
**Note:** `/api/audit` and `/api/notifications` allow any authenticated user (by design) -- filtering at service layer.

### Group B: User Management -- 7 Permissions (10 tests)
Tests each user management feature privilege individually.

### Group C: System -- 5 Permissions (14 tests)
Tests each system feature privilege individually.

### Group D: Entity Management -- 6 Permissions (13 tests)
Tests each entity feature privilege individually.

### Group E: Entity Templates -- 4 Permissions (8 tests)
Tests each template feature privilege individually.

### Group F: Cross-Permission Isolation (9 tests)
Validates permissions don't leak across categories.

### Group G: SUPER_ADMIN Bypass (7 tests)
Validates SUPER_ADMIN bypasses all permission checks.

### Group H: requireRole Passthrough (3 tests)
Tests broad access gate behavior.

---

## Architecture: Two Permission Systems

```
Frontend (RoleConfig)          Backend (Role)
  permissions: {dotNotation}     permissions: [SNAKE_CASE]
  assets.view = true        -->  ASSET_VIEW
  config.edit = true        -->  CONFIG_UPDATE
```

### Complete Permission Matrix (52+ Privileges)

**Core Permissions (22):** User Management (7), System (5), Entity Management (6), Entity Templates (4)

**Phase 2 Filter Permissions (17):** FILTER_OPERATE, FILTER_BYPASS, FCP_READ, FCP_CREATE, FCP_UPDATE, FP_READ, FP_CREATE, FP_UPDATE, CYCLE_READ, EVENT_READ, CHECKLIST_SUBMIT, PM_READ, PM_CREATE, PM_UPDATE, PM_EXECUTE, EQG_READ, EQG_MANAGE

**Additional Permissions (13+):** UNS_VIEW, RULE_CHAIN_VIEW, RULE_CHAIN_UPDATE, READ_DEBUG_TRACE, NOTIFICATION_MANAGE, APPROVAL_REQUEST, APPROVAL_REVIEW, and more.

## Phase 2 RBAC Test Results (2026-04-04)
- Filter operations: Permission enforcement verified for all 17 filter permissions
- Non-authorized roles correctly denied access to filter endpoints (403)
- SUPER_ADMIN bypasses all filter permission checks
- Organization scoping prevents cross-tenant data access
- 30 GitHub issues created and closed (#36-#65)

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
