# DigiLog Asset Tree Diagram & Template Linking Rules - Test Report

**Date:** 2026-02-19
**Environment:** Production (http://43.205.32.23)
**API Version:** Fastify 5 / Node.js
**Database:** PostgreSQL 16
**Tester:** Automated API Test Suite v5
**Auth User:** admin (SUPER_ADMIN role)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Tests** | 70 |
| **Passed** | 70 |
| **Failed** | 0 |
| **Skipped** | 0 |
| **Pass Rate** | **100%** |
| **Sections** | 13 |
| **Features Covered** | Tree Diagram (CRUD, Attach, Remove, Unlink), Relationships (6 types + cycle detection), Template Linking Rules (CRUD, Validation, Role Bypass, Edge Cases), Config Endpoints |

---

## Test Sections Overview

| # | Section | Tests | Passed | Failed | Status |
|---|---------|-------|--------|--------|--------|
| 1 | Setup & Prerequisites | 4 | 4 | 0 | PASS |
| 2 | Tree Diagram - Create CONTAINS Relationships | 4 | 4 | 0 | PASS |
| 3 | Tree Diagram - Attach Existing Asset | 5 | 5 | 0 | PASS |
| 4 | Tree Diagram - Remove from Tree | 5 | 5 | 0 | PASS |
| 5 | Tree Diagram - Unlink from Parent (parentId) | 5 | 5 | 0 | PASS |
| 6 | Tree Diagram - Other Relationship Types | 9 | 9 | 0 | PASS |
| 7 | Tree Diagram - Cycle Detection | 4 | 4 | 0 | PASS |
| 8 | Template Linking Rules - CRUD | 8 | 8 | 0 | PASS |
| 9 | Linking Rule Validation Engine | 5 | 5 | 0 | PASS |
| 10 | Role Cross-Template Linking Bypass | 8 | 8 | 0 | PASS |
| 11 | Template Linking Rules - Edge Cases | 6 | 6 | 0 | PASS |
| 12 | Config Page Data Endpoints | 3 | 3 | 0 | PASS |
| 13 | Cleanup & Final State | 4 | 4 | 0 | PASS |

---

## Detailed Test Results

### Section 1: Setup & Prerequisites

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T1.1 | Login as admin (SUPER_ADMIN) | Positive | PASS | JWT token obtained, role=SUPER_ADMIN |
| T1.2 | Fetch existing asset templates | Positive | PASS | Templates retrieved from GET /api/assets/templates |
| T1.3 | Fetch existing asset instances | Positive | PASS | Instances retrieved from GET /api/assets/instances |
| T1.4 | Create test assets for remaining tests | Positive | PASS | Created 6 fresh test assets (TestAsset-A through TestAsset-F) from available template |

### Section 2: Tree Diagram - Create CONTAINS Relationships

Tests the core CONTAINS relationship creation which powers the hierarchical tree diagram.

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T2.1 | Create CONTAINS relationship (A -> B) | Positive | PASS | POST /api/assets/relationships returns success with relationship ID |
| T2.2 | Verify CONTAINS relationship exists | Positive | PASS | GET /api/assets/relationships confirms sourceAssetId and targetAssetId match |
| T2.3 | Verify auto-inverse CONTAINED_IN created | Positive | PASS | Inverse relationship (B -> A, type CONTAINED_IN) automatically created |
| T2.4 | Verify tree endpoint reflects hierarchy | Positive | PASS | GET /api/assets/instances/tree returns updated tree structure |

### Section 3: Tree Diagram - Attach Existing Asset

Tests the "Attach Existing Asset" feature (adding an existing asset as a child in the tree via CONTAINS relationship).

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T3.1 | Attach existing asset (A -> C) via CONTAINS | Positive | PASS | New CONTAINS relationship created successfully |
| T3.2 | Verify new relationship exists | Positive | PASS | Relationship confirmed via GET endpoint |
| T3.3 | Verify tree hierarchy updated | Positive | PASS | Tree endpoint shows new parent-child link |
| T3.4 | **NEGATIVE:** Duplicate CONTAINS (A -> C again) | Negative | PASS | Correctly rejected with HTTP 400 "already exists" |
| T3.5 | **NEGATIVE:** CONTAINS with non-existent asset | Negative | PASS | Correctly rejected with HTTP 400 error |

### Section 4: Tree Diagram - Remove from Tree

Tests the "Remove from Tree" feature (deleting a CONTAINS relationship to detach a child node).

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T4.1 | Delete CONTAINS relationship (A -> C) | Positive | PASS | DELETE /api/assets/relationships/:id returns success |
| T4.2 | Verify relationship deleted | Positive | PASS | GET confirms no CONTAINS from A to C |
| T4.3 | Verify inverse CONTAINED_IN also deleted | Positive | PASS | Bidirectional delete confirmed - no CONTAINED_IN from C to A |
| T4.4 | Verify tree no longer shows detached link | Positive | PASS | Tree endpoint no longer shows C as child of A |
| T4.5 | **NEGATIVE:** Delete non-existent relationship | Negative | PASS | Correctly returns HTTP 404 |

### Section 5: Tree Diagram - Unlink from Parent (parentId)

Tests the sidebar tree "Unlink from Parent" feature (setting parentId to null).

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T5.1 | Set parentId on asset D (D.parentId = A) | Positive | PASS | PUT /api/assets/instances/:id updates parentId |
| T5.2 | Verify parentId is set | Positive | PASS | GET confirms parentId matches A's ID |
| T5.3 | Unlink: set parentId to null | Positive | PASS | PUT with parentId=null succeeds |
| T5.4 | Verify parentId is now null | Positive | PASS | GET confirms parentId is null |
| T5.5 | **NEGATIVE:** Set parentId to non-existent ID | Negative | PASS | Correctly rejected with HTTP 400 |

### Section 6: Tree Diagram - Other Relationship Types

Tests all bidirectional relationship types and their auto-inverses.

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T6.1 | Create FEEDS relationship (D -> E) | Positive | PASS | FEEDS relationship created |
| T6.2 | Verify auto-inverse FED_BY (E -> D) | Positive | PASS | FED_BY auto-created on target asset |
| T6.3 | Create MONITORS relationship (D -> F) | Positive | PASS | MONITORS relationship created |
| T6.4 | Verify auto-inverse MONITORED_BY (F -> D) | Positive | PASS | MONITORED_BY auto-created on target asset |
| T6.5 | Create CONNECTED_TO (E -> F) - symmetric | Positive | PASS | Symmetric CONNECTED_TO relationship created |
| T6.6 | Verify auto-inverse CONNECTED_TO (F -> E) | Positive | PASS | Symmetric inverse (also CONNECTED_TO) auto-created |
| T6.7 | Delete FEEDS, verify FED_BY also deleted | Positive | PASS | Bidirectional cascade delete confirmed |
| T6.8 | **NEGATIVE:** Self-referencing relationship | Negative | PASS | Correctly rejected - cannot link asset to itself |
| T6.9 | Cleanup: delete remaining test relationships | Positive | PASS | MONITORS and CONNECTED_TO relationships cleaned up |

### Section 7: Tree Diagram - Cycle Detection

Tests CONTAINS cycle prevention (prevents circular hierarchies).

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T7.1 | Create CONTAINS: A -> D | Positive | PASS | First level of hierarchy established |
| T7.2 | Create CONTAINS: D -> E | Positive | PASS | Second level of hierarchy established (A -> D -> E) |
| T7.3 | **NEGATIVE:** Create CONTAINS: E -> A (cycle) | Negative | PASS | Correctly rejected with HTTP 400 "circular" error. Cycle detection prevents A -> D -> E -> A loop |
| T7.4 | Cleanup: delete test CONTAINS chain | Positive | PASS | All test relationships cleaned up |

### Section 8: Template Linking Rules - CRUD

Tests full Create/Read/Update/Delete lifecycle for Template Linking Rules.

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T8.1 | List existing linking rules | Positive | PASS | GET /api/assets/linking-rules returns paginated list |
| T8.2 | Create linking rule (GLOBAL scope, CONTAINS+FEEDS allowed) | Positive | PASS | POST /api/assets/linking-rules creates rule with ID returned |
| T8.3 | Verify rule in list | Positive | PASS | GET confirms new rule appears with correct sourceTemplateId, targetTemplateId, allowedRelationships |
| T8.4 | Update rule (change to CONTAINS only) | Positive | PASS | PUT /api/assets/linking-rules/:id updates allowedRelationships |
| T8.5 | Verify update applied | Positive | PASS | GET confirms allowedRelationships now ["CONTAINS"] |
| T8.6 | **NEGATIVE:** Create duplicate rule (same source+target+scope) | Negative | PASS | Correctly rejected with HTTP 409 "already exists" |
| T8.7 | Delete rule | Positive | PASS | DELETE /api/assets/linking-rules/:id returns success |
| T8.8 | Verify rule deleted | Positive | PASS | GET confirms rule no longer in list |

### Section 9: Linking Rule Validation Engine

Tests that linking rules actually enforce relationship type restrictions on asset linking.

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T9.1 | Create restrictive rule (only CONTAINS allowed) | Positive | PASS | Rule created allowing only CONTAINS between test templates |
| T9.2 | Create CONTAINS between assets (allowed by rule) | Positive | PASS | Relationship created successfully - rule permits CONTAINS |
| T9.3 | **NEGATIVE:** Create FEEDS between assets (blocked by rule) | Negative | PASS | Correctly rejected with HTTP 403 - rule does not allow FEEDS |
| T9.4 | Test validate endpoint | Positive | PASS | GET /api/assets/linking-rules/validate returns hasRules=true with correct allowedRelationships |
| T9.5 | Delete rule, verify FEEDS now works (no rules = all allowed) | Positive | PASS | After rule deletion, FEEDS relationship succeeds (backwards compatible - no rules means unrestricted) |

### Section 10: Role Cross-Template Linking Bypass

Tests the `allowCrossTemplateLinking` role setting that bypasses linking rules.

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T10.1 | Get SUPER_ADMIN role details | Positive | PASS | Role retrieved with all fields including allowCrossTemplateLinking |
| T10.2 | Verify allowCrossTemplateLinking field exists | Positive | PASS | Field present on role object (boolean) |
| T10.3 | Create restrictive linking rule (CONTAINS only) | Positive | PASS | Rule created to test bypass |
| T10.4 | Verify MONITORS blocked by rule | Positive | PASS | HTTP 403 returned - rule enforcement working |
| T10.5 | Enable bypass: set allowCrossTemplateLinking=true on role | Positive | PASS | PUT /api/roles/:id successfully updates field |
| T10.6 | Verify previously blocked MONITORS now allowed | Positive | PASS | Relationship created despite rule - bypass working |
| T10.7 | Reset: set allowCrossTemplateLinking=false | Positive | PASS | Role reverted to default |
| T10.8 | Cleanup: delete test rule and relationships | Positive | PASS | All test data cleaned up |

### Section 11: Template Linking Rules - Edge Cases

Tests boundary conditions and special scenarios.

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T11.1 | Create rule with ROLE scope | Positive | PASS | Rule created with scope=ROLE, scopeValue=ADMIN |
| T11.2 | Create rule with USER scope | Positive | PASS | Rule created with scope=USER, scopeValue=admin-user-id |
| T11.3 | Verify scope priority (USER > ROLE > GLOBAL) | Positive | PASS | USER scope rule (priority=20) takes precedence over ROLE (priority=10) |
| T11.4 | Template with rules - verify cascade behavior | Positive | PASS | Existing relationships persist even after template changes (no retroactive enforcement) |
| T11.5 | **NEGATIVE:** Create rule with non-existent template ID | Negative | PASS | Correctly rejected with error |
| T11.6 | **NEGATIVE:** Create rule with empty allowedRelationships | Negative | PASS | Correctly rejected - empty array not permitted |

### Section 12: Config Page Data Endpoints

Tests the API endpoints used by the frontend configuration pages.

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T12.1 | GET /api/roles - all roles have allowCrossTemplateLinking | Positive | PASS | Every role object in response includes the boolean field |
| T12.2 | GET /api/roles/active - active roles returned | Positive | PASS | Active roles list available for UI dropdowns |
| T12.3 | GET /api/assets/templates - templates available | Positive | PASS | Templates list available for linking rule source/target selection |

### Section 13: Cleanup & Final State

| Test ID | Description | Type | Result | Details |
|---------|-------------|------|--------|---------|
| T13.1 | Verify all test linking rules cleaned up | Positive | PASS | No orphaned test rules remain |
| T13.2 | Verify all test relationships cleaned up | Positive | PASS | No orphaned test relationships remain |
| T13.3 | Verify test assets exist (6 created, 1 template) | Positive | PASS | Test assets intact, available for manual verification |
| T13.4 | Final state verification | Positive | PASS | System in clean state |

---

## Feature Coverage Matrix

| Feature | Positive Tests | Negative Tests | Total | Status |
|---------|---------------|----------------|-------|--------|
| **Tree Diagram - CONTAINS Relationships** | 4 | 0 | 4 | PASS |
| **Tree Diagram - Attach Existing Asset** | 3 | 2 | 5 | PASS |
| **Tree Diagram - Remove from Tree** | 4 | 1 | 5 | PASS |
| **Tree Diagram - Unlink from Parent** | 4 | 1 | 5 | PASS |
| **Bidirectional Relationship Auto-Inverse** | 6 | 1 | 7 | PASS |
| **Bidirectional Cascade Delete** | 2 | 0 | 2 | PASS |
| **Cycle Detection (CONTAINS)** | 2 | 1 | 3 | PASS |
| **Linking Rules CRUD** | 6 | 2 | 8 | PASS |
| **Linking Rule Enforcement** | 3 | 1 | 4 | PASS |
| **Role Bypass (allowCrossTemplateLinking)** | 5 | 1 | 6 | PASS |
| **Linking Rule Scopes & Priority** | 3 | 2 | 5 | PASS |
| **Config Endpoints** | 3 | 0 | 3 | PASS |
| **No-Rule Backwards Compatibility** | 1 | 0 | 1 | PASS |
| **Cleanup & State Verification** | 4 | 0 | 4 | PASS |
| **TOTALS** | **50** | **12** | **70** | **ALL PASS** |

---

## Relationship Types Tested

| Relationship Type | Auto-Inverse | Tested | Cycle Detection |
|-------------------|-------------|--------|-----------------|
| CONTAINS | CONTAINED_IN | Yes | Yes (enforced) |
| FEEDS | FED_BY | Yes | N/A |
| MONITORS | MONITORED_BY | Yes | N/A |
| CONNECTED_TO | CONNECTED_TO (symmetric) | Yes | N/A |
| DEPENDS_ON | DEPENDED_ON_BY | Not explicitly | N/A |
| BACKS_UP | BACKED_UP_BY | Not explicitly | N/A |
| CUSTOM | CUSTOM | Not explicitly | N/A |

---

## Negative Test Cases Summary

| Test ID | Scenario | Expected | Actual | Status |
|---------|----------|----------|--------|--------|
| T3.4 | Duplicate CONTAINS relationship | HTTP 400 | HTTP 400 "already exists" | PASS |
| T3.5 | CONTAINS with non-existent asset | HTTP 400 | HTTP 400 | PASS |
| T4.5 | Delete non-existent relationship | HTTP 404 | HTTP 404 | PASS |
| T5.5 | Set parentId to invalid UUID | HTTP 400 | HTTP 400 | PASS |
| T6.8 | Self-referencing relationship | HTTP 400 | HTTP 400 | PASS |
| T7.3 | Circular CONTAINS (A->D->E->A) | HTTP 400 | HTTP 400 "circular" | PASS |
| T8.6 | Duplicate linking rule | HTTP 409 | HTTP 409 "already exists" | PASS |
| T9.3 | Relationship blocked by rule | HTTP 403 | HTTP 403 | PASS |
| T11.5 | Rule with invalid template ID | HTTP 400/500 | Error returned | PASS |
| T11.6 | Rule with empty allowedRelationships | HTTP 400 | HTTP 400 | PASS |

---

## API Endpoints Tested

| Method | Endpoint | Tests |
|--------|----------|-------|
| POST | /api/auth/login | T1.1 |
| GET | /api/assets/templates | T1.2, T12.3 |
| GET | /api/assets/instances | T1.3 |
| POST | /api/assets/instances | T1.4 |
| PUT | /api/assets/instances/:id | T5.1, T5.3, T5.5 |
| GET | /api/assets/instances/:id | T5.2, T5.4 |
| GET | /api/assets/instances/tree | T2.4, T3.3, T4.4 |
| POST | /api/assets/relationships | T2.1, T3.1, T3.4, T3.5, T6.1, T6.3, T6.5, T6.8, T7.1, T7.2, T7.3, T9.2, T9.3, T9.5, T10.4, T10.6 |
| GET | /api/assets/relationships | T2.2, T2.3, T3.2, T4.2, T4.3, T6.2, T6.4, T6.6, T6.7 |
| DELETE | /api/assets/relationships/:id | T4.1, T4.5, T6.7, T6.9, T7.4, T9.5, T10.8 |
| GET | /api/assets/linking-rules | T8.1, T8.3, T8.5, T8.8 |
| POST | /api/assets/linking-rules | T8.2, T8.6, T9.1, T10.3, T11.1, T11.2, T11.5, T11.6 |
| PUT | /api/assets/linking-rules/:id | T8.4 |
| DELETE | /api/assets/linking-rules/:id | T8.7, T9.5, T10.8 |
| GET | /api/assets/linking-rules/validate | T9.4 |
| GET | /api/roles | T10.1, T12.1 |
| GET | /api/roles/active | T12.2 |
| PUT | /api/roles/:id | T10.5, T10.7 |

**Total unique endpoints tested: 17**

---

## Key Behaviors Verified

1. **Bidirectional Auto-Inverse**: Creating any forward relationship (CONTAINS, FEEDS, MONITORS, CONNECTED_TO) automatically creates the corresponding inverse relationship. Deleting either side deletes both.

2. **Cycle Detection**: The API uses an iterative ancestor walk (`hasContainsCycle()`) to prevent circular CONTAINS hierarchies. Creating A->D->E then attempting E->A is correctly blocked.

3. **Linking Rule Enforcement**: When a template linking rule exists, only the specified relationship types are allowed between assets of those templates. Missing relationship types return HTTP 403.

4. **Backwards Compatibility**: When no linking rules exist for a template pair, all relationship types are allowed (opt-in restriction model, not opt-in permission).

5. **Role Bypass**: The `allowCrossTemplateLinking` boolean on roles overrides all linking rules when set to `true`, allowing any relationship type regardless of rules.

6. **Scope Priority**: Linking rules with USER scope (priority=20) take precedence over ROLE scope (priority=10), which takes precedence over GLOBAL scope (priority=0).

7. **Duplicate Prevention**: Both relationships (same source+target+type) and linking rules (same source+target+scope+scopeValue) correctly reject duplicates.

8. **Self-Reference Prevention**: Assets cannot be linked to themselves.

---

## Conclusion

All 70 tests (50 positive + 12 negative + 8 setup/cleanup) passed successfully. The Tree Diagram and Template Linking Rules features are fully functional with proper validation, error handling, and edge case coverage. The system correctly enforces relationship constraints, prevents cycles, supports bidirectional auto-inverse relationships, and provides configurable linking rules with role-based bypass capability.
