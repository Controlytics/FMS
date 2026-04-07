# TC-09: Audit Trail -- Test Cases

## Overview
- **Module**: Audit Trail
- **API Endpoints**: 4 (GET /, GET /:id, DELETE /:id, POST /bulk-delete)
- **Frontend Pages**: /audit
- **Permissions**: All authenticated users can read; DELETE and bulk-delete require CONFIG_UPDATE permission (SUPER_ADMIN)
- **Key Facts**: SHA-256 checksum on {timestamp, userId, action, targetType, targetId, afterValue}. SUPER_ADMIN actions are NOT logged (21 CFR Part 11 exemption). Deletion is audit-logged before execution. 60+ audit action types including Phase 2 filter operations (FILTER_CYCLE_STARTED, FILTER_STAGE_ADVANCED, FILTER_STAGE_BYPASSED, FILTER_CHECKLIST_SUBMITTED, FILTER_CYCLE_COMPLETED).

---

## Positive Test Cases

### TC-09-P01: List Audit Records with Default Pagination
- **Priority**: High
- **Preconditions**: User is authenticated. At least one non-SUPER_ADMIN audit record exists (e.g., from an ADMIN login).
- **Test Data**: None required.
- **Steps**:
  1. Send GET /api/audit without any query parameters.
  2. Verify the response status is 200.
  3. Verify the response body contains `data` (array), `total` (integer), `page` (1), `limit` (20), `totalPages`.
  4. Verify each record in `data` has `id`, `action`, `timestamp`, and `integrityValid` fields.
- **Expected Result**: Paginated response with up to 20 records, page 1, and all records have `integrityValid: true`.

### TC-09-P02: List Audit Records with Custom Pagination
- **Priority**: Medium
- **Preconditions**: User is authenticated. More than 5 audit records exist.
- **Test Data**: `page=2&limit=5`
- **Steps**:
  1. Send GET /api/audit?page=2&limit=5.
  2. Verify the response returns page 2 with up to 5 records.
  3. Verify `totalPages` matches `Math.ceil(total / 5)`.
- **Expected Result**: Page 2 returned with correct pagination metadata.

### TC-09-P03: Filter Audit Records by Action Type
- **Priority**: High
- **Preconditions**: At least one LOGIN audit record exists from a non-SUPER_ADMIN user.
- **Test Data**: `action=LOGIN`
- **Steps**:
  1. Send GET /api/audit?action=LOGIN.
  2. Verify all returned records have `action: "LOGIN"`.
  3. Verify `total` reflects only LOGIN records.
- **Expected Result**: Only LOGIN records returned.

### TC-09-P04: Filter Audit Records by User ID
- **Priority**: High
- **Preconditions**: Multiple audit records exist for different users.
- **Test Data**: `userId=admin` (or an ADMIN-role user ID)
- **Steps**:
  1. Send GET /api/audit?userId=admin.
  2. Verify all returned records have `userId: "admin"`.
- **Expected Result**: Only records for the specified user are returned.

### TC-09-P05: Filter Audit Records by Date Period (Today)
- **Priority**: High
- **Preconditions**: At least one audit record was created today by a non-SUPER_ADMIN user.
- **Test Data**: `period=today`
- **Steps**:
  1. Send GET /api/audit?period=today.
  2. Verify all returned records have timestamps from today (midnight onward).
- **Expected Result**: Only today's records returned.

### TC-09-P06: Filter Audit Records by Custom Date Range
- **Priority**: Medium
- **Preconditions**: Audit records exist spanning multiple days.
- **Test Data**: `startDate=2026-03-01T00:00:00Z&endDate=2026-03-05T23:59:59Z`
- **Steps**:
  1. Send GET /api/audit?startDate=2026-03-01T00:00:00Z&endDate=2026-03-05T23:59:59Z.
  2. Verify all returned records have timestamps within the specified range.
- **Expected Result**: Only records within the date range are returned.

### TC-09-P07: Filter Audit Records by Target Type
- **Priority**: Medium
- **Preconditions**: Audit records with various target types exist.
- **Test Data**: `targetType=USER`
- **Steps**:
  1. Send GET /api/audit?targetType=USER.
  2. Verify all returned records have `targetType: "USER"`.
- **Expected Result**: Only records targeting USER entities are returned.

### TC-09-P08: Search Audit Records Across Fields
- **Priority**: Medium
- **Preconditions**: Audit records exist with various actions and users.
- **Test Data**: `search=LOGIN`
- **Steps**:
  1. Send GET /api/audit?search=LOGIN.
  2. Verify returned records contain "LOGIN" in either userId, action, targetType, targetId, or userRole fields (case-insensitive).
- **Expected Result**: Records matching the search term across any searchable field are returned.

### TC-09-P09: Sort Audit Records by Action Ascending
- **Priority**: Low
- **Preconditions**: Multiple audit records exist with different actions.
- **Test Data**: `sortBy=action&sortOrder=asc`
- **Steps**:
  1. Send GET /api/audit?sortBy=action&sortOrder=asc.
  2. Verify records are sorted alphabetically by action in ascending order.
- **Expected Result**: Records sorted by action A-Z.

### TC-09-P10: Get Single Audit Record with Checksum Verification
- **Priority**: High
- **Preconditions**: At least one audit record exists. Obtain a valid record ID from the list endpoint.
- **Test Data**: Valid audit record ID (UUID).
- **Steps**:
  1. Send GET /api/audit to get a record list.
  2. Pick the first record's `id`.
  3. Send GET /api/audit/{id}.
  4. Verify response includes all fields: id, userId, userRole, action, targetType, targetId, beforeValue, afterValue, reason, ipAddress, userAgent, sessionId, checksum, signatureMeaning, previousChecksum, timestamp, integrityValid.
  5. Verify `integrityValid` is `true`.
- **Expected Result**: Single record returned with full details and `integrityValid: true`.

### TC-09-P11: Delete Single Audit Record (SUPER_ADMIN)
- **Priority**: High
- **Preconditions**: Authenticated as SUPER_ADMIN (admin/Admin@123). At least one non-SUPER_ADMIN audit record exists.
- **Test Data**: Valid audit record ID to delete.
- **Steps**:
  1. Send GET /api/audit to list records and note the ID and total count.
  2. Send DELETE /api/audit/{id}.
  3. Verify response: `{ success: true }`.
  4. Send GET /api/audit/{id} and verify 404 response.
  5. Send GET /api/audit?action=AUDIT_RECORD_DELETED and verify a new audit record was created documenting the deletion.
- **Expected Result**: Record deleted successfully. Deletion itself is audit-logged as AUDIT_RECORD_DELETED before execution.

### TC-09-P12: Bulk Delete Audit Records (SUPER_ADMIN)
- **Priority**: High
- **Preconditions**: Authenticated as SUPER_ADMIN. At least 3 non-SUPER_ADMIN audit records exist.
- **Test Data**: Array of 3 valid audit record IDs.
- **Steps**:
  1. Send GET /api/audit and collect 3 record IDs.
  2. Send POST /api/audit/bulk-delete with body `{ "ids": [id1, id2, id3] }`.
  3. Verify response: `{ success: true, count: 3 }`.
  4. Verify each deleted record returns 404 on GET /api/audit/{id}.
  5. Verify an AUDIT_RECORDS_BULK_DELETED audit entry was created.
- **Expected Result**: All 3 records deleted. Bulk deletion is audit-logged.

### TC-09-P13: SUPER_ADMIN Actions Not Logged (21 CFR Part 11 Exemption)
- **Priority**: High
- **Preconditions**: Authenticated as SUPER_ADMIN.
- **Test Data**: None.
- **Steps**:
  1. Note the current total audit count via GET /api/audit?period=today.
  2. As SUPER_ADMIN, perform some action (e.g., view users).
  3. Send GET /api/audit to list records.
  4. Verify that the response filters out records with `userRole: "SUPER_ADMIN"` (the WHERE clause adds `userRole: { not: 'SUPER_ADMIN' }`).
  5. No SUPER_ADMIN action records should appear in the results.
- **Expected Result**: SUPER_ADMIN actions are excluded from audit trail queries.

### TC-09-P14: Verify Checksum Integrity on Multiple Records
- **Priority**: High
- **Preconditions**: Multiple audit records exist.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/audit?limit=50.
  2. For each record in the response, verify `integrityValid` is `true`.
- **Expected Result**: All records pass integrity verification.

### TC-09-P15: Filter by Week Period
- **Priority**: Low
- **Preconditions**: Audit records exist from the past 7 days.
- **Test Data**: `period=week`
- **Steps**:
  1. Send GET /api/audit?period=week.
  2. Verify all returned records have timestamps within the last 7 days.
- **Expected Result**: Only records from the past week are returned.

---

## Negative Test Cases

### TC-09-N01: Delete Audit Record Without CONFIG_UPDATE Permission
- **Priority**: High
- **Preconditions**: Authenticated as a non-SUPER_ADMIN user (e.g., OPERATOR role) without CONFIG_UPDATE permission.
- **Test Data**: Valid audit record ID.
- **Steps**:
  1. Send DELETE /api/audit/{id} as OPERATOR.
  2. Verify response is 403 Forbidden.
- **Expected Result**: 403 error with "Insufficient permissions" message.

### TC-09-N02: Bulk Delete Without CONFIG_UPDATE Permission
- **Priority**: High
- **Preconditions**: Authenticated as a non-SUPER_ADMIN user without CONFIG_UPDATE permission.
- **Test Data**: `{ "ids": [1, 2, 3] }`
- **Steps**:
  1. Send POST /api/audit/bulk-delete as OPERATOR.
  2. Verify response is 403 Forbidden.
- **Expected Result**: 403 error.

### TC-09-N03: Get Non-Existent Audit Record
- **Priority**: Medium
- **Preconditions**: Authenticated user.
- **Test Data**: Non-existent ID (e.g., 999999).
- **Steps**:
  1. Send GET /api/audit/999999.
  2. Verify response is 404 with `{ error: "Audit record not found" }`.
- **Expected Result**: 404 Not Found.

### TC-09-N04: Delete Non-Existent Audit Record
- **Priority**: Medium
- **Preconditions**: Authenticated as SUPER_ADMIN.
- **Test Data**: Non-existent ID (e.g., 999999).
- **Steps**:
  1. Send DELETE /api/audit/999999.
  2. Verify response is 404 with `{ error: "Audit record not found" }`.
- **Expected Result**: 404 Not Found.

### TC-09-N05: Bulk Delete with Empty IDs Array
- **Priority**: Medium
- **Preconditions**: Authenticated as SUPER_ADMIN.
- **Test Data**: `{ "ids": [] }`
- **Steps**:
  1. Send POST /api/audit/bulk-delete with `{ "ids": [] }`.
  2. Verify response is 400 (minItems: 1 validation fails).
- **Expected Result**: 400 validation error because ids array must have at least 1 item.

### TC-09-N06: Access Audit Trail Without Authentication
- **Priority**: High
- **Preconditions**: No authentication token.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/audit without Authorization header.
  2. Verify response is 401 Unauthorized.
- **Expected Result**: 401 Unauthorized.

### TC-09-N07: Tampered Checksum Detection (integrityValid: false)
- **Priority**: High
- **Preconditions**: Authenticated as SUPER_ADMIN with direct database access.
- **Test Data**: A valid audit record ID.
- **Steps**:
  1. Get a valid audit record ID from GET /api/audit.
  2. Directly modify the `afterValue` field in the `audit_trail` table via SQL without updating the checksum.
  3. Send GET /api/audit/{id}.
  4. Verify `integrityValid` is `false`.
- **Expected Result**: The tampered record is flagged with `integrityValid: false`, indicating checksum mismatch.

### TC-09-N08: Invalid Sort Field
- **Priority**: Low
- **Preconditions**: Authenticated user.
- **Test Data**: `sortBy=invalidField`
- **Steps**:
  1. Send GET /api/audit?sortBy=invalidField.
  2. Verify the API falls back to default sort (timestamp desc) without error.
- **Expected Result**: API returns 200 with records sorted by timestamp (fallback behavior).

### TC-09-N09: Bulk Delete with Non-Existent IDs
- **Priority**: Low
- **Preconditions**: Authenticated as SUPER_ADMIN.
- **Test Data**: `{ "ids": [999998, 999999] }`
- **Steps**:
  1. Send POST /api/audit/bulk-delete with non-existent IDs.
  2. Verify the audit log entry is still created for the attempt.
  3. Verify response: `{ success: true, count: 0 }`.
- **Expected Result**: Operation succeeds with count 0 (no records matched).


---

## Phase 2: Filter Operation Audit Test Cases

### TC-09-P16: Audit Trail for Filter Cycle Start
- **Priority**: High
- **Preconditions**: Filter cycle started by non-SUPER_ADMIN user
- **Test Data**: `action=FILTER_CYCLE_STARTED`
- **Steps**:
  1. Start a cleaning cycle as ADMIN user
  2. Send GET /api/audit?action=FILTER_CYCLE_STARTED
  3. Verify audit record includes filterId, cycleId, userId, and timestamp
  4. Verify integrityValid is true
- **Expected Result**: Filter cycle start is audit-logged with full traceability

### TC-09-P17: Audit Trail for Filter Stage Bypass (Deviation)
- **Priority**: High
- **Preconditions**: Stage bypassed by non-SUPER_ADMIN user
- **Test Data**: `action=FILTER_STAGE_BYPASSED`
- **Steps**:
  1. Bypass a filter stage as ADMIN user with deviation reason
  2. Send GET /api/audit?action=FILTER_STAGE_BYPASSED
  3. Verify audit record includes bypass reason, stage name, and deviation notes in afterValue
  4. Verify integrityValid is true
- **Expected Result**: Bypass deviations are fully audit-logged for regulatory compliance

### TC-09-P18: Audit Trail for Filter Checklist Submission
- **Priority**: Medium
- **Preconditions**: Checklist submitted at a CHECKLIST node
- **Test Data**: `action=FILTER_CHECKLIST_SUBMITTED`
- **Steps**:
  1. Submit a checklist at a pipeline CHECKLIST node
  2. Send GET /api/audit?action=FILTER_CHECKLIST_SUBMITTED
  3. Verify audit record includes checklist answers in afterValue
- **Expected Result**: Checklist submissions are audit-logged with answer data


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
