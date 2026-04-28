# TC-16: Data Export -- Test Cases

## Overview
- **Module**: Data Export
- **API Endpoints**: 5 (GET /export/telemetry/:entityId, GET /export/checklist/:entityId, GET /export/alarms, GET /export/attributes/:entityId, GET /export/status/:jobId)
- **Frontend Pages**: Export accessible from entity detail tabs
- **Permissions**: ASSET_VIEW (all endpoints)
- **Formats**: CSV (default) and JSON
- **Key Facts**: Configurable max range (default 90 days), max rows (default 1M). Truncation indicated via X-DigiLog-Truncated header. Date range validation (from must be before to). Export status endpoint is a stub for future async processing.

---

## Positive Test Cases

### TC-16-P01: Export Telemetry as CSV
- **Priority**: High
- **Preconditions**: Entity has telemetry data in ts_telemetry within the date range.
- **Test Data**: Valid entityId, date range, format=csv (default).
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId}?from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z.
  2. Verify response Content-Type is `text/csv`.
  3. Verify Content-Disposition header contains `attachment; filename="telemetry-..."`.
  4. Verify CSV has header row and data rows.
- **Expected Result**: CSV file with telemetry data columns: time, entity_id, key, value_num, value_str, value_bool, value_json, uns_path, source, source_ip.

### TC-16-P02: Export Telemetry as JSON
- **Priority**: High
- **Preconditions**: Entity has telemetry data.
- **Test Data**: `format=json`
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId}?from=...&to=...&format=json.
  2. Verify response Content-Type is `application/json`.
  3. Verify response is a JSON array of objects.
- **Expected Result**: JSON array of telemetry records.

### TC-16-P03: Export Telemetry with Key Filter
- **Priority**: Medium
- **Preconditions**: Entity has multiple telemetry keys.
- **Test Data**: `keys=temperature,humidity`
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId}?from=...&to=...&keys=temperature,humidity&format=json.
  2. Verify only records with key "temperature" or "humidity" are returned.
- **Expected Result**: Filtered export with only specified keys.

### TC-16-P04: Export Alarms as CSV
- **Priority**: High
- **Preconditions**: Alarms exist within the date range.
- **Test Data**: Date range.
- **Steps**:
  1. Send GET /api/export/alarms?from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z.
  2. Verify CSV response with alarm data.
- **Expected Result**: CSV file with alarm records.

### TC-16-P05: Export Alarms as JSON
- **Priority**: Medium
- **Preconditions**: Alarms exist.
- **Test Data**: `format=json`
- **Steps**:
  1. Send GET /api/export/alarms?from=...&to=...&format=json.
  2. Verify JSON array of alarm objects.
- **Expected Result**: JSON array of alarms.

### TC-16-P06: Export Alarms with Status Filter
- **Priority**: Medium
- **Preconditions**: Alarms with different statuses exist.
- **Test Data**: `status=ACTIVE`
- **Steps**:
  1. Send GET /api/export/alarms?from=...&to=...&status=ACTIVE&format=json.
  2. Verify all exported alarms have status ACTIVE.
- **Expected Result**: Only ACTIVE alarms in export.

### TC-16-P07: Export Alarms with Severity Filter
- **Priority**: Low
- **Preconditions**: Alarms with different severities.
- **Test Data**: `severity=CRITICAL`
- **Steps**:
  1. Send GET /api/export/alarms?from=...&to=...&severity=CRITICAL&format=json.
  2. Verify all exported alarms are CRITICAL.
- **Expected Result**: Only CRITICAL alarms exported.

### TC-16-P08: Export Alarms with Entity Filter
- **Priority**: Medium
- **Preconditions**: Alarms for specific entity.
- **Test Data**: `entityId=<uuid>`
- **Steps**:
  1. Send GET /api/export/alarms?from=...&to=...&entityId=<uuid>&format=json.
  2. Verify all exported alarms belong to the entity.
- **Expected Result**: Entity-filtered alarm export.

### TC-16-P09: Export Attribute History as CSV
- **Priority**: Medium
- **Preconditions**: Entity has attribute history in ts_attributes.
- **Test Data**: Valid entityId, date range.
- **Steps**:
  1. Send GET /api/export/attributes/{entityId}?from=...&to=...
  2. Verify CSV response with attribute history.
- **Expected Result**: CSV with time, entity_id, scope, key, value columns.

### TC-16-P10: Export Attribute History with Key Filter
- **Priority**: Low
- **Preconditions**: Entity has multiple attribute keys.
- **Test Data**: `key=firmware_version`
- **Steps**:
  1. Send GET /api/export/attributes/{entityId}?from=...&to=...&key=firmware_version&format=json.
  2. Verify only records for firmware_version key.
- **Expected Result**: Filtered attribute export.

### TC-16-P11: Export Checklist Responses
- **Priority**: Medium
- **Preconditions**: Entity has checklist submissions.
- **Test Data**: Valid entityId, date range.
- **Steps**:
  1. Send GET /api/export/checklist/{entityId}?from=...&to=...&format=json.
  2. Verify merged data from ChecklistReview (PG) and ts_checklist_responses (TSDB).
  3. Verify fields include review_status, checked_by from PG merge.
- **Expected Result**: Merged checklist data with review status.

### TC-16-P12: Export Status Endpoint (Stub)
- **Priority**: Low
- **Preconditions**: Authenticated.
- **Test Data**: Any jobId string.
- **Steps**:
  1. Send GET /api/export/status/some-job-id.
  2. Verify response: `{ status: "not_implemented", message: "Async exports will be available in a future update" }`.
- **Expected Result**: Stub response indicating future feature.

### TC-16-P13: Export with No Data in Range
- **Priority**: Medium
- **Preconditions**: No data in the specified date range.
- **Test Data**: Date range in the far future.
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId}?from=2030-01-01T00:00:00Z&to=2030-01-02T00:00:00Z&format=json.
  2. Verify empty array returned.
- **Expected Result**: Empty JSON array `[]` or empty CSV (header only).

---

## Negative Test Cases

### TC-16-N01: Export Without ASSET_VIEW Permission
- **Priority**: High
- **Preconditions**: Authenticated as user without ASSET_VIEW permission.
- **Test Data**: Any valid export parameters.
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId}?from=...&to=... without ASSET_VIEW.
  2. Verify 403 Forbidden.
- **Expected Result**: 403 error.

### TC-16-N02: Export with Invalid Date Range (from > to)
- **Priority**: High
- **Preconditions**: Authenticated.
- **Test Data**: `from=2026-03-05T00:00:00Z&to=2026-03-01T00:00:00Z`
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId} with from after to.
  2. Verify 400 `{ error: "INVALID_DATE_RANGE", message: "from must be before to" }`.
- **Expected Result**: 400 error.

### TC-16-N03: Export with Date Range Exceeding Maximum
- **Priority**: Medium
- **Preconditions**: Authenticated. Default max range is 90 days.
- **Test Data**: Date range of 100+ days.
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId}?from=2025-01-01T00:00:00Z&to=2026-03-05T00:00:00Z.
  2. Verify 400 `{ error: "INVALID_DATE_RANGE", message: "Date range exceeds maximum of 90 days" }`.
- **Expected Result**: 400 error for exceeding max range.

### TC-16-N04: Export with Invalid Date Format
- **Priority**: Medium
- **Preconditions**: Authenticated.
- **Test Data**: `from=not-a-date&to=also-not-a-date`
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId}?from=not-a-date&to=also-not-a-date.
  2. Verify 400 `{ error: "INVALID_DATE_RANGE", message: "Invalid date format" }`.
- **Expected Result**: 400 error for invalid date format.

### TC-16-N05: Export Without Required Date Parameters
- **Priority**: Medium
- **Preconditions**: Authenticated.
- **Test Data**: Missing from/to.
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId} without from/to query params.
  2. Verify 400 validation error.
- **Expected Result**: 400 validation error for missing required querystring.

### TC-16-N06: Export Without Authentication
- **Priority**: High
- **Preconditions**: No auth token.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/export/telemetry/{entityId}?from=...&to=... without Authorization header.
  2. Verify 401.
- **Expected Result**: 401 Unauthorized.

### TC-16-N07: Export Alarms with Invalid Status
- **Priority**: Low
- **Preconditions**: Authenticated.
- **Test Data**: `status=INVALID`
- **Steps**:
  1. Send GET /api/export/alarms?from=...&to=...&status=INVALID.
  2. Verify behavior -- may be 400 or return no results.
- **Expected Result**: 400 validation error or empty results.


---

## Phase 2 Notes

- Export endpoints apply to filter entities. Telemetry, attributes, and alarms for filter instances can be exported in CSV/JSON format.
- Filter cleaning cycle history and events can be retrieved via GET /api/filter/cycles and GET /api/filter/events (these are list endpoints, not export endpoints).
- Future: dedicated filter report export may be added.


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
