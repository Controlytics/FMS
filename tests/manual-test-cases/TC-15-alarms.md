# TC-15: Alarms -- Test Cases

## Overview
- **Module**: Alarms
- **API Endpoints**: 5 (GET / list, GET /summary, GET /:entityId entity alarms, POST /:id/acknowledge, POST /:id/clear)
- **Frontend Pages**: /alarms
- **Permissions**: ASSET_VIEW (list, summary, entity alarms), ALARM_MANAGE (acknowledge, clear)
- **Reauth Actions**: ACKNOWLEDGE_ALARM, CLEAR_ALARM
- **Statuses**: ACTIVE, ACKNOWLEDGED, CLEARED, MANUALLY_CLEARED
- **Alarm Rule Types**: HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM
- **Severities**: CRITICAL, MAJOR, MINOR, WARNING, INFO
- **Key Facts**: Electronic signatures required for acknowledge/clear. SHA-256 hashes. Alarms enriched with entityName. Deduplication: no duplicate ACTIVE alarms of same type per entity.

---

## Positive Test Cases

### TC-15-P01: List Alarms with Default Pagination
- **Priority**: High
- **Preconditions**: At least one alarm exists.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/alarms.
  2. Verify response: `{ data: [...], total, page: 1, limit: 50, totalPages }`.
  3. Verify each alarm has id, entityId, entityName, alarmType, severity, status, createdAt.
- **Expected Result**: Paginated alarm list with enriched entity names.

### TC-15-P02: List Alarms Filtered by Status
- **Priority**: High
- **Preconditions**: Alarms with different statuses exist.
- **Test Data**: `status=ACTIVE`
- **Steps**:
  1. Send GET /api/alarms?status=ACTIVE.
  2. Verify all returned alarms have `status: "ACTIVE"`.
- **Expected Result**: Only ACTIVE alarms returned.

### TC-15-P03: List Alarms Filtered by Severity
- **Priority**: Medium
- **Preconditions**: Alarms with different severities exist.
- **Test Data**: `severity=CRITICAL`
- **Steps**:
  1. Send GET /api/alarms?severity=CRITICAL.
  2. Verify all returned alarms have `severity: "CRITICAL"`.
- **Expected Result**: Only CRITICAL alarms returned.

### TC-15-P04: List Alarms Filtered by Entity
- **Priority**: Medium
- **Preconditions**: Multiple alarms for a specific entity.
- **Test Data**: `entityId=<valid-uuid>`
- **Steps**:
  1. Send GET /api/alarms?entityId=<uuid>.
  2. Verify all returned alarms belong to that entity.
- **Expected Result**: Only alarms for the specified entity.

### TC-15-P05: List Alarms Filtered by Date Range
- **Priority**: Medium
- **Preconditions**: Alarms spanning multiple days.
- **Test Data**: `from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z`
- **Steps**:
  1. Send GET /api/alarms?from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z.
  2. Verify all alarms have createdAt within range.
- **Expected Result**: Date-filtered alarm list.

### TC-15-P06: List Alarms Sorted by Severity
- **Priority**: Low
- **Preconditions**: Alarms with different severities.
- **Test Data**: `sortBy=severity&sortDir=desc`
- **Steps**:
  1. Send GET /api/alarms?sortBy=severity&sortDir=desc.
  2. Verify sorting order.
- **Expected Result**: Alarms sorted by severity descending.

### TC-15-P07: Get Alarm Summary Counts
- **Priority**: High
- **Preconditions**: Alarms in various statuses exist.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/alarms/summary.
  2. Verify response: `{ active: N, acknowledged: N, cleared: N, critical: N }`.
  3. Verify `critical` counts only CRITICAL severity alarms that are not cleared.
- **Expected Result**: Summary counts for each status category.

### TC-15-P08: Get Alarms for Specific Entity
- **Priority**: High
- **Preconditions**: Entity has alarms.
- **Test Data**: Valid entityId.
- **Steps**:
  1. Send GET /api/alarms/{entityId}.
  2. Verify response: paginated list of alarms for that entity.
  3. Verify entityName is populated on each alarm.
- **Expected Result**: Entity-specific alarm list with enriched names.

### TC-15-P09: Get Entity Alarms Filtered by Status
- **Priority**: Medium
- **Preconditions**: Entity has both ACTIVE and CLEARED alarms.
- **Test Data**: `status=ACTIVE`
- **Steps**:
  1. Send GET /api/alarms/{entityId}?status=ACTIVE.
  2. Verify all returned are ACTIVE.
- **Expected Result**: Only ACTIVE alarms for the entity.

### TC-15-P10: Acknowledge Alarm (ACTIVE to ACKNOWLEDGED)
- **Priority**: High
- **Preconditions**: An ACTIVE alarm exists. User has ALARM_MANAGE permission.
- **Test Data**: `{"signerFullName": "Test Admin", "meaning": "Alarm reviewed and acknowledged", "remarks": "Within acceptable tolerance"}`
- **Steps**:
  1. Find an ACTIVE alarm ID.
  2. Send POST /api/alarms/{id}/acknowledge (reauth may be required).
  3. Verify response: `{ alarm: { status: "ACKNOWLEDGED", acknowledged: true, acknowledgedBy: "admin", ... }, signature: { ... } }`.
  4. Verify electronic signature created with signatureHash.
  5. Verify audit entry ALARM_ACKNOWLEDGED created.
- **Expected Result**: Alarm transitions to ACKNOWLEDGED with electronic signature.

### TC-15-P11: Clear Alarm (ACTIVE/ACKNOWLEDGED to MANUALLY_CLEARED)
- **Priority**: High
- **Preconditions**: An ACTIVE or ACKNOWLEDGED alarm exists. User has ALARM_MANAGE permission.
- **Test Data**: `{"signerFullName": "Test Admin", "meaning": "Alarm condition resolved", "remarks": "Root cause addressed"}`
- **Steps**:
  1. Find an ACTIVE or ACKNOWLEDGED alarm ID.
  2. Send POST /api/alarms/{id}/clear (reauth may be required).
  3. Verify response: `{ alarm: { status: "MANUALLY_CLEARED", cleared: true, clearedBy: "admin", ... }, signature: { ... } }`.
  4. Verify audit entry ALARM_CLEARED created.
- **Expected Result**: Alarm transitions to MANUALLY_CLEARED with electronic signature.

### TC-15-P12: Alarm Deduplication (No Duplicate ACTIVE Alarms)
- **Priority**: High
- **Preconditions**: Data ingestion pipeline is active. Entity has alarm rules configured.
- **Test Data**: Send telemetry that triggers the same alarm type twice.
- **Steps**:
  1. Send telemetry that triggers an alarm (e.g., temperature > threshold).
  2. Verify ACTIVE alarm created.
  3. Send the same telemetry again.
  4. Verify NO new ACTIVE alarm created (deduplication).
  5. Query GET /api/alarms?entityId=...&status=ACTIVE&alarmType=... and verify count is 1.
- **Expected Result**: Only one ACTIVE alarm per type per entity. Second trigger does not create duplicate.

### TC-15-P13: List Alarms with Multiple Filters Combined
- **Priority**: Medium
- **Preconditions**: Various alarms exist.
- **Test Data**: `status=ACTIVE&severity=CRITICAL&entityId=<uuid>`
- **Steps**:
  1. Send GET /api/alarms?status=ACTIVE&severity=CRITICAL&entityId=<uuid>.
  2. Verify all returned alarms match ALL filter criteria.
- **Expected Result**: Intersection of all filters applied.

---

## Negative Test Cases

### TC-15-N01: Acknowledge Non-ACTIVE Alarm
- **Priority**: High
- **Preconditions**: An alarm in ACKNOWLEDGED or CLEARED status.
- **Test Data**: `{"signerFullName": "Admin", "meaning": "Acknowledge"}`
- **Steps**:
  1. Send POST /api/alarms/{alreadyAcknowledgedId}/acknowledge.
  2. Verify 400 `{ error: "INVALID_STATUS", message: "Alarm must be in ACTIVE status to acknowledge" }`.
- **Expected Result**: 400 error -- can only acknowledge ACTIVE alarms.

### TC-15-N02: Clear Already Cleared Alarm
- **Priority**: High
- **Preconditions**: An alarm in CLEARED or MANUALLY_CLEARED status.
- **Test Data**: `{"signerFullName": "Admin", "meaning": "Clear"}`
- **Steps**:
  1. Send POST /api/alarms/{clearedAlarmId}/clear.
  2. Verify 400 `{ error: "INVALID_STATUS", message: "Alarm must be in ACTIVE or ACKNOWLEDGED status to clear manually" }`.
- **Expected Result**: 400 error.

### TC-15-N03: Acknowledge Without ALARM_MANAGE Permission
- **Priority**: High
- **Preconditions**: Authenticated as user without ALARM_MANAGE permission.
- **Test Data**: Valid ACTIVE alarm ID.
- **Steps**:
  1. Send POST /api/alarms/{id}/acknowledge without ALARM_MANAGE.
  2. Verify 403 Forbidden.
- **Expected Result**: 403 error.

### TC-15-N04: Clear Without ALARM_MANAGE Permission
- **Priority**: High
- **Preconditions**: Authenticated as user without ALARM_MANAGE permission.
- **Test Data**: Valid alarm ID.
- **Steps**:
  1. Send POST /api/alarms/{id}/clear without ALARM_MANAGE.
  2. Verify 403 Forbidden.
- **Expected Result**: 403 error.

### TC-15-N05: Acknowledge Non-Existent Alarm
- **Priority**: Medium
- **Preconditions**: Authenticated with ALARM_MANAGE.
- **Test Data**: `id=00000000-0000-0000-0000-000000000000`
- **Steps**:
  1. Send POST /api/alarms/00000000-0000-0000-0000-000000000000/acknowledge with required body.
  2. Verify 404 `{ error: "NOT_FOUND", message: "Alarm not found" }`.
- **Expected Result**: 404 Not Found.

### TC-15-N06: Clear Non-Existent Alarm
- **Priority**: Medium
- **Preconditions**: Authenticated with ALARM_MANAGE.
- **Test Data**: Non-existent alarm UUID.
- **Steps**:
  1. Send POST /api/alarms/00000000-0000-0000-0000-000000000000/clear with required body.
  2. Verify 404.
- **Expected Result**: 404 Not Found.

### TC-15-N07: Acknowledge Without Required signerFullName
- **Priority**: Medium
- **Preconditions**: ACTIVE alarm exists, user has ALARM_MANAGE.
- **Test Data**: `{"meaning": "Acknowledged"}` (missing signerFullName)
- **Steps**:
  1. Send POST /api/alarms/{id}/acknowledge without signerFullName.
  2. Verify 400 validation error.
- **Expected Result**: 400 validation error for missing required field.

### TC-15-N08: Filter with Invalid Status Value
- **Priority**: Low
- **Preconditions**: Authenticated.
- **Test Data**: `status=INVALID_STATUS`
- **Steps**:
  1. Send GET /api/alarms?status=INVALID_STATUS.
  2. Verify behavior (may return 400 or empty results depending on validation).
- **Expected Result**: 400 validation error or empty results.

### TC-15-N09: Access Alarms Without Authentication
- **Priority**: High
- **Preconditions**: No auth token.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/alarms without Authorization header.
  2. Verify 401.
- **Expected Result**: 401 Unauthorized.
