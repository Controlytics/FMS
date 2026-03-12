# DigiLog RBAC Test Results

**Date:** 2026-02-23 10:29:39 UTC (original run), last verified 2026-03-07
**Tester:** Automated Script (rbac-test.sh)
**Test Role:** `RBAC_TEST` (hierarchy level 1, custom role)
**Test User:** `999999`
**API Base:** http://localhost:3000
**Note (2026-03-07):** All 73 RBAC tests continue to pass. Permission migration to `requirePermission()` (from `requireRole()`) completed across rule chains, data ingestion, debug, help, and UNS routes. RBAC architecture remains stable with 39+ granular permissions across 10 categories.

---

## Summary

| Metric | Count |
|--------|-------|
| **Total Tests** | 73 |
| **Passed** | 73 |
| **Failed** | 0 |
| **Pass Rate** | **100.0%** |

---

## Detailed Test Results

| ID | Category | Permission | Test Description | Expected | Actual | Status |
|----|----------|-----------|------------------|----------|--------|--------|
| A01 | Baseline | `none` | GET /users — denied | 403 | HTTP 403 | **PASS** |
| A02 | Baseline | `none` | GET /audit — any auth (by design) | 200 | HTTP 200 | **PASS** |
| A03 | Baseline | `none` | GET /config/password-policy — denied | 403 | HTTP 403 | **PASS** |
| A04 | Baseline | `none` | GET /assets/instances — denied | 403 | HTTP 403 | **PASS** |
| A05 | Baseline | `none` | GET /assets/templates — denied | 403 | HTTP 403 | **PASS** |
| A06 | Baseline | `none` | GET /notifications — any auth (by design) | 200 | HTTP 200 | **PASS** |
| A07 | Baseline | `none` | GET /config/my-config — always allowed | 200 | HTTP 200 | **PASS** |
| A08 | Baseline | `none` | GET /auth/me — always allowed | 200 | HTTP 200 | **PASS** |
| A09 | Baseline | `none` | Sidebar empty with no perms | 0 | 0 items | **PASS** |
| B01 | Users | `users.view` | GET /users — allowed | 200 | HTTP 200 | **PASS** |
| B02 | Users | `users.view` | GET /users/stats — allowed | 200 | HTTP 200 | **PASS** |
| B03 | Users | `users.view` | my-config users.view=true | true | true | **PASS** |
| B04 | Users | `users.view` | Sidebar has users | users | users | **PASS** |
| B05 | Users | `users.create` | my-config users.create=true | true | true | **PASS** |
| B06 | Users | `users.edit` | my-config users.edit=true | true | true | **PASS** |
| B07 | Users | `users.delete` | my-config users.delete=true | true | true | **PASS** |
| B08 | Users | `users.reset_password` | my-config users.reset_password=true | true | true | **PASS** |
| B09 | Users | `users.unlock` | my-config users.unlock=true | true | true | **PASS** |
| B10 | Users | `users.enable_disable` | my-config users.enable_disable=true | true | true | **PASS** |
| C01 | System | `config.view` | GET /config/password-policy — allowed | 200 | HTTP 200 | **PASS** |
| C02 | System | `config.view` | GET /config/datetime — allowed | 200 | HTTP 200 | **PASS** |
| C03 | System | `config.view` | GET /config/session — allowed | 200 | HTTP 200 | **PASS** |
| C04 | System | `config.view` | GET /assets/instances — denied (no asset perm) | 403 | HTTP 403 | **PASS** |
| C05 | System | `config.view` | my-config config.view=true | true | true | **PASS** |
| C06 | System | `config.view` | Sidebar has configuration | configuration | configuration | **PASS** |
| C07 | System | `config.edit` | my-config config.edit=true | true | true | **PASS** |
| C08 | System | `audit.view` | GET /audit — allowed | 200 | HTTP 200 | **PASS** |
| C09 | System | `audit.view` | my-config audit.view=true | true | true | **PASS** |
| C10 | System | `audit.view` | Sidebar has audit | audit | audit | **PASS** |
| C11 | System | `audit.export` | my-config audit.export=true | true | true | **PASS** |
| C12 | System | `notifications.manage` | GET /notifications — allowed | 200 | HTTP 200 | **PASS** |
| C13 | System | `notifications.manage` | my-config notifications.manage=true | true | true | **PASS** |
| C14 | System | `notifications.manage` | Sidebar has notifications | notifications | notifications | **PASS** |
| D01 | Entity | `assets.view` | GET /assets/instances — allowed | 200 | HTTP 200 | **PASS** |
| D02 | Entity | `assets.view` | GET /assets/instances/tree — allowed | 200 | HTTP 200 | **PASS** |
| D03 | Entity | `assets.view` | GET /assets/relationships — allowed | 200 | HTTP 200 | **PASS** |
| D04 | Entity | `assets.view` | GET /assets/identifiers — allowed | 200 | HTTP 200 | **PASS** |
| D05 | Entity | `assets.view` | GET /assets/templates — denied (no template perm) | 403 | HTTP 403 | **PASS** |
| D06 | Entity | `assets.view` | my-config assets.view=true | true | true | **PASS** |
| D07 | Entity | `assets.view` | Sidebar has assets | assets | assets | **PASS** |
| D08 | Entity | `assets.create` | GET /assets/instances — denied (no view) | 403 | HTTP 403 | **PASS** |
| D09 | Entity | `assets.create` | my-config assets.create=true | true | true | **PASS** |
| D10 | Entity | `assets.edit` | my-config assets.edit=true | true | true | **PASS** |
| D11 | Entity | `assets.delete` | my-config assets.delete=true | true | true | **PASS** |
| D12 | Entity | `assets.relationships` | my-config assets.relationships=true | true | true | **PASS** |
| D13 | Entity | `assets.identifiers` | my-config assets.identifiers=true | true | true | **PASS** |
| E01 | Templates | `assets.templates_view` | GET /assets/templates — allowed | 200 | HTTP 200 | **PASS** |
| E02 | Templates | `assets.templates_view` | POST /assets/templates — denied | 403 | HTTP 403 | **PASS** |
| E03 | Templates | `assets.templates_view` | my-config assets.templates_view=true | true | true | **PASS** |
| E04 | Templates | `assets.templates_view` | Sidebar has asset-templates | asset-templates | asset-templates | **PASS** |
| E05 | Templates | `assets.templates_create` | GET /assets/templates — denied (no view) | 403 | HTTP 403 | **PASS** |
| E06 | Templates | `assets.templates_create` | my-config assets.templates_create=true | true | true | **PASS** |
| E07 | Templates | `assets.templates_edit` | my-config assets.templates_edit=true | true | true | **PASS** |
| E08 | Templates | `assets.templates_delete` | my-config assets.templates_delete=true | true | true | **PASS** |
| F01 | Isolation | `assets.view` | GET /assets/instances — allowed | 200 | HTTP 200 | **PASS** |
| F02 | Isolation | `assets.view` | GET /assets/templates — denied | 403 | HTTP 403 | **PASS** |
| F03 | Isolation | `audit.view` | GET /audit — allowed | 200 | HTTP 200 | **PASS** |
| F04 | Isolation | `audit.view` | GET /assets/instances — denied | 403 | HTTP 403 | **PASS** |
| F05 | Isolation | `multi` | GET /assets/instances — allowed | 200 | HTTP 200 | **PASS** |
| F06 | Isolation | `multi` | GET /audit — allowed | 200 | HTTP 200 | **PASS** |
| F07 | Isolation | `multi` | GET /config/password-policy — allowed | 200 | HTTP 200 | **PASS** |
| F08 | Isolation | `multi` | POST /assets/instances — denied (no create) | 403 | HTTP 403 | **PASS** |
| F09 | Isolation | `multi` | my-config has exactly 3 true perms | 3 | 3 | **PASS** |
| G01 | SA Bypass | `SUPER_ADMIN` | GET /users | 200 | HTTP 200 | **PASS** |
| G02 | SA Bypass | `SUPER_ADMIN` | GET /audit | 200 | HTTP 200 | **PASS** |
| G03 | SA Bypass | `SUPER_ADMIN` | GET /assets/instances | 200 | HTTP 200 | **PASS** |
| G04 | SA Bypass | `SUPER_ADMIN` | GET /assets/templates | 200 | HTTP 200 | **PASS** |
| G05 | SA Bypass | `SUPER_ADMIN` | GET /config/password-policy | 200 | HTTP 200 | **PASS** |
| G06 | SA Bypass | `SUPER_ADMIN` | GET /notifications | 200 | HTTP 200 | **PASS** |
| G07 | SA Bypass | `SUPER_ADMIN` | GET /roles | 200 | HTTP 200 | **PASS** |
| H01 | Passthrough | `ASSET_VIEW` | GET /users — allowed (any perm = pass) | 200 | HTTP 200 | **PASS** |
| H02 | Passthrough | `ASSET_VIEW` | GET /config — allowed (any perm = pass) | 200 | HTTP 200 | **PASS** |
| H03 | Passthrough | `ASSET_VIEW` | GET /templates — denied (wrong perm) | 403 | HTTP 403 | **PASS** |

---

## Test Group Descriptions

### Group A: Zero Permissions Baseline (9 tests)
Validates behavior when test role has NO permissions. Protected endpoints deny access.
**Note:** `/api/audit` and `/api/notifications` allow any authenticated user (by design) — filtering at service layer.

### Group B: User Management — 7 Permissions (10 tests)
Tests each user management feature privilege individually:

| Feature Privilege | API Permission | What It Controls |
|------------------|---------------|-----------------|
| `users.view` | `USER_READ` | View user list, stats |
| `users.create` | `USER_CREATE` | Create new users |
| `users.edit` | `USER_UPDATE` | Edit existing users |
| `users.delete` | `USER_DELETE` | Delete users, bulk delete |
| `users.reset_password` | `USER_RESET_PASSWORD` | Reset user passwords |
| `users.unlock` | `USER_UNLOCK` | Unlock locked accounts |
| `users.enable_disable` | `USER_ENABLE_DISABLE` | Enable/disable accounts |

### Group C: System — 5 Permissions (14 tests)
Tests each system feature privilege individually:

| Feature Privilege | API Permission | What It Controls |
|------------------|---------------|-----------------|
| `config.view` | `CONFIG_READ` | View system configuration |
| `config.edit` | `CONFIG_UPDATE` | Edit system configuration |
| `audit.view` | `AUDIT_READ` | View audit trail |
| `audit.export` | `AUDIT_EXPORT` | Export audit trail data |
| `notifications.manage` | `NOTIFICATION_MANAGE` | Manage notifications |

### Group D: Entity Management — 6 Permissions (13 tests)
Tests each entity feature privilege individually:

| Feature Privilege | API Permission | What It Controls |
|------------------|---------------|-----------------|
| `assets.view` | `ASSET_VIEW` | View entities, relationships, identifiers |
| `assets.create` | `ASSET_CREATE` | Create new entities |
| `assets.edit` | `ASSET_UPDATE` | Edit entities, change status |
| `assets.delete` | `ASSET_DELETE` | Delete entities |
| `assets.relationships` | `ASSET_RELATIONSHIP_MANAGE` | Create/delete relationships |
| `assets.identifiers` | `ASSET_IDENTIFIER_MANAGE` | Create/delete identifiers |

### Group E: Entity Templates — 4 Permissions (8 tests)
Tests each template feature privilege individually:

| Feature Privilege | API Permission | What It Controls |
|------------------|---------------|-----------------|
| `assets.templates_view` | `ASSET_TEMPLATE_VIEW` | View entity templates |
| `assets.templates_create` | `ASSET_TEMPLATE_CREATE` | Create new templates |
| `assets.templates_edit` | `ASSET_TEMPLATE_UPDATE` | Edit existing templates |
| `assets.templates_delete` | `ASSET_TEMPLATE_DELETE` | Delete templates |

### Group F: Cross-Permission Isolation (9 tests)
Validates permissions don't leak across categories — e.g., `ASSET_VIEW` doesn't grant template access.

### Group G: SUPER_ADMIN Bypass (7 tests)
Validates SUPER_ADMIN bypasses all permission checks.

### Group H: requireRole Passthrough (3 tests)
Tests that roles with ANY permission pass `requireRole` checks (broad access gate).
Fine-grained enforcement is by `requirePermission` on specific endpoints and frontend UI gating.

---

## Architecture: Two Permission Systems

```
┌─────────────────────────────────────────────────────┐
│                Role Access Config Page               │
│              (/config/role-privileges)               │
│                                                     │
│  Sidebar: [✓] Entities  [✓] Audit  [ ] Users       │
│  Perms:   [✓] assets.view  [✓] audit.view          │
└──────────────────────┬──────────────────────────────┘
                       │ PUT /api/config/roles/:role
                       ▼
          ┌────────────────────────────┐
          │    FEATURE_TO_PERMISSION_MAP │ (sync bridge)
          │  assets.view → ASSET_VIEW   │
          │  audit.view  → AUDIT_READ   │
          └─────────┬──────────┬───────┘
                    │          │
    ┌───────────────▼──┐  ┌───▼─────────────────┐
    │ RoleConfig Table  │  │    Role Table        │
    │ permissions: {}   │  │    permissions: []   │
    │ (dot.notation)    │  │    (SNAKE_CASE)      │
    └───────┬──────────┘  └──────────┬───────────┘
            │                        │
    ┌───────▼──────────┐  ┌──────────▼───────────┐
    │  Frontend UI      │  │   API Middleware      │
    │  /api/config/     │  │   requirePermission() │
    │  my-config        │  │   requireRole()       │
    │  → sidebar items  │  │   → 403 if denied     │
    │  → button gating  │  │                       │
    └──────────────────┘  └──────────────────────┘
```

### Complete Permission Matrix (22 Privileges)

| # | Feature Privilege | API Permission | Category |
|---|------------------|---------------|----------|
| 1 | `users.view` | `USER_READ` | User Management |
| 2 | `users.create` | `USER_CREATE` | User Management |
| 3 | `users.edit` | `USER_UPDATE` | User Management |
| 4 | `users.delete` | `USER_DELETE` | User Management |
| 5 | `users.reset_password` | `USER_RESET_PASSWORD` | User Management |
| 6 | `users.unlock` | `USER_UNLOCK` | User Management |
| 7 | `users.enable_disable` | `USER_ENABLE_DISABLE` | User Management |
| 8 | `config.view` | `CONFIG_READ` | System |
| 9 | `config.edit` | `CONFIG_UPDATE` | System |
| 10 | `audit.view` | `AUDIT_READ` | System |
| 11 | `audit.export` | `AUDIT_EXPORT` | System |
| 12 | `notifications.manage` | `NOTIFICATION_MANAGE` | System |
| 13 | `assets.view` | `ASSET_VIEW` | Entity Management |
| 14 | `assets.create` | `ASSET_CREATE` | Entity Management |
| 15 | `assets.edit` | `ASSET_UPDATE` | Entity Management |
| 16 | `assets.delete` | `ASSET_DELETE` | Entity Management |
| 17 | `assets.relationships` | `ASSET_RELATIONSHIP_MANAGE` | Entity Management |
| 18 | `assets.identifiers` | `ASSET_IDENTIFIER_MANAGE` | Entity Management |
| 19 | `assets.templates_view` | `ASSET_TEMPLATE_VIEW` | Entity Templates |
| 20 | `assets.templates_create` | `ASSET_TEMPLATE_CREATE` | Entity Templates |
| 21 | `assets.templates_edit` | `ASSET_TEMPLATE_UPDATE` | Entity Templates |
| 22 | `assets.templates_delete` | `ASSET_TEMPLATE_DELETE` | Entity Templates |
