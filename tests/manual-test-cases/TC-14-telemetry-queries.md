# TC-14: Telemetry Queries -- Test Cases

## Overview
- **Module**: Telemetry Queries
- **API Endpoints**: 7 (GET /telemetry/:entityId/latest, GET /telemetry/:entityId/timeseries, GET /telemetry/:entityId/keys, GET /attributes/:entityId/:scope, GET /attributes/:entityId/history, GET /checklist/:entityId/responses, GET /checklist/:entityId/history)
- **Frontend Pages**: /assets (telemetry tab, attributes tab, checklist tab)
- **Permissions**: ASSET_VIEW (all endpoints)
- **Key Facts**: TimescaleDB time_bucket aggregation, auto-interval selection, 6 aggregation functions (none, avg, min, max, sum, count), attribute scopes (client, server, all). Max 50,000 data points per query.

---

## Positive Test Cases

### TC-14-P01: Get Latest Telemetry for Entity
- **Priority**: High
- **Preconditions**: Entity has telemetry data in latest_telemetry table.
- **Test Data**: Valid entityId.
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/latest.
  2. Verify response is an array of latest telemetry records.
  3. Each record has key, valueNum/valueStr/valueBool/valueJson, lastUpdated.
- **Expected Result**: Array of latest values for all telemetry keys.

### TC-14-P02: Query Telemetry Time-Series (Raw, No Aggregation)
- **Priority**: High
- **Preconditions**: Entity has telemetry data in ts_telemetry within a known time range.
- **Test Data**: entityId, `from=2026-03-01T00:00:00Z`, `to=2026-03-05T23:59:59Z`, `aggregation=none`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z&aggregation=none.
  2. Verify response has `data` (array of raw data points) and `meta` object.
  3. Meta has entityId, from, to, aggregation: "none", interval: null, totalPoints, aggregated: false.
- **Expected Result**: Raw telemetry data points returned, ordered by time DESC.

### TC-14-P03: Query Telemetry with Key Filter
- **Priority**: Medium
- **Preconditions**: Entity has multiple telemetry keys.
- **Test Data**: `keys=temperature,humidity`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&keys=temperature,humidity.
  2. Verify only records with key "temperature" or "humidity" are returned.
- **Expected Result**: Filtered data containing only specified keys.

### TC-14-P04: Query Telemetry with AVG Aggregation
- **Priority**: High
- **Preconditions**: Entity has numeric telemetry data.
- **Test Data**: `aggregation=avg&interval=1h`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&aggregation=avg&interval=1h.
  2. Verify response data has bucketed time entries with averaged values.
  3. Verify meta has `aggregated: true`, `interval: "1 hour"`.
- **Expected Result**: Aggregated data with 1-hour buckets, average values.

### TC-14-P05: Query Telemetry with MIN Aggregation
- **Priority**: Medium
- **Preconditions**: Entity has numeric telemetry data.
- **Test Data**: `aggregation=min&interval=1d`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&aggregation=min&interval=1d.
  2. Verify each bucket has the minimum value_num for that day.
- **Expected Result**: Daily minimum values.

### TC-14-P06: Query Telemetry with MAX Aggregation
- **Priority**: Medium
- **Preconditions**: Entity has numeric telemetry data.
- **Test Data**: `aggregation=max&interval=1d`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&aggregation=max&interval=1d.
  2. Verify each bucket has the maximum value.
- **Expected Result**: Daily maximum values.

### TC-14-P07: Query Telemetry with SUM Aggregation
- **Priority**: Low
- **Preconditions**: Entity has numeric telemetry data.
- **Test Data**: `aggregation=sum&interval=1h`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&aggregation=sum&interval=1h.
  2. Verify summed values per bucket.
- **Expected Result**: Hourly sum values.

### TC-14-P08: Query Telemetry with COUNT Aggregation
- **Priority**: Low
- **Preconditions**: Entity has telemetry data.
- **Test Data**: `aggregation=count&interval=1h`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&aggregation=count&interval=1h.
  2. Verify count of data points per bucket.
- **Expected Result**: Hourly data point counts.

### TC-14-P09: Query Telemetry with Auto Interval
- **Priority**: Medium
- **Preconditions**: Entity has telemetry data.
- **Test Data**: `aggregation=avg&interval=auto` (or just `aggregation=avg` since auto is default)
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries with a 2-hour range and `aggregation=avg`.
  2. Verify the auto-selected interval is "1 minute" (range <= 60min).
  3. Send same with 7-day range.
  4. Verify interval is "1 hour" (1440 < span <= 10080 minutes).
- **Expected Result**: Interval auto-selected based on time range span.

### TC-14-P10: Get Available Telemetry Keys
- **Priority**: High
- **Preconditions**: Entity has active data streams.
- **Test Data**: Valid entityId.
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/keys.
  2. Verify response is an array with key, dataType, source, unsPath, updatedAt.
- **Expected Result**: List of all active data stream keys for the entity.

### TC-14-P11: Get Current Attributes by Scope (All)
- **Priority**: High
- **Preconditions**: Entity has attributes in ts_attributes table.
- **Test Data**: `scope=all`
- **Steps**:
  1. Send GET /api/attributes/{entityId}/all.
  2. Verify response is an array with key, value, updatedBy, lastUpdated.
  3. Verify values are coalesced from valueJson/valueBool/valueNum/valueStr columns.
- **Expected Result**: All scope attributes returned with latest values.

### TC-14-P12: Get Attribute Change History
- **Priority**: Medium
- **Preconditions**: Entity has attribute history in ts_attributes.
- **Test Data**: `from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z`
- **Steps**:
  1. Send GET /api/attributes/{entityId}/history?from=...&to=...
  2. Verify paginated response with data array, total, page, limit.
  3. Each record has time, key, scope, valueNum, valueStr, valueBool, valueJson, updatedBy.
- **Expected Result**: Paginated attribute change history.

### TC-14-P13: Get Attribute History Filtered by Key
- **Priority**: Low
- **Preconditions**: Entity has multiple attribute keys.
- **Test Data**: `from=...&to=...&key=firmware_version`
- **Steps**:
  1. Send GET /api/attributes/{entityId}/history?from=...&to=...&key=firmware_version.
  2. Verify all records have key "firmware_version".
- **Expected Result**: Filtered history for single key.

### TC-14-P14: List Checklist Responses
- **Priority**: Medium
- **Preconditions**: Entity has checklist submissions.
- **Test Data**: Valid entityId.
- **Steps**:
  1. Send GET /api/checklist/{entityId}/responses.
  2. Verify paginated response with checklist review records.
- **Expected Result**: Paginated list of checklist responses.

### TC-14-P15: Query Telemetry with Custom Limit
- **Priority**: Low
- **Preconditions**: Entity has many data points.
- **Test Data**: `limit=100`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&limit=100.
  2. Verify at most 100 data points returned.
- **Expected Result**: Data limited to 100 points.

---

## Negative Test Cases

### TC-14-N01: Query Non-Existent Entity
- **Priority**: Medium
- **Preconditions**: Authenticated with ASSET_VIEW.
- **Test Data**: `entityId=00000000-0000-0000-0000-000000000000`
- **Steps**:
  1. Send GET /api/telemetry/00000000-0000-0000-0000-000000000000/latest.
  2. Verify response is empty array (no error, just no data).
- **Expected Result**: Empty array returned (entity not found but no error).

### TC-14-N02: Time-Series Query Without Required Parameters
- **Priority**: Medium
- **Preconditions**: Authenticated.
- **Test Data**: Missing `from` and `to`.
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries without from/to.
  2. Verify 400 validation error.
- **Expected Result**: 400 error for missing required querystring parameters.

### TC-14-N03: Invalid Aggregation Type
- **Priority**: Low
- **Preconditions**: Authenticated.
- **Test Data**: `aggregation=median`
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&aggregation=median.
  2. Verify it falls back to "none" (not in valid set).
- **Expected Result**: Defaults to "none" aggregation without error.

### TC-14-N04: Invalid Attribute Scope
- **Priority**: Low
- **Preconditions**: Authenticated.
- **Test Data**: `scope=invalid`
- **Steps**:
  1. Send GET /api/attributes/{entityId}/invalid.
  2. Verify 400 `{ error: "VALIDATION_ERROR", message: "Scope must be..." }`.
- **Expected Result**: 400 validation error.

### TC-14-N05: Query Without ASSET_VIEW Permission
- **Priority**: High
- **Preconditions**: Authenticated as user without ASSET_VIEW permission.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/latest without ASSET_VIEW permission.
  2. Verify 403.
- **Expected Result**: 403 Forbidden.

### TC-14-N06: Time-Series Query with Limit Exceeding Maximum
- **Priority**: Low
- **Preconditions**: Authenticated.
- **Test Data**: `limit=100000` (max is 50000)
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/timeseries?from=...&to=...&limit=100000.
  2. Verify limit is capped at 50000 (server-side clamping).
- **Expected Result**: Query executes with limit capped at 50000.

### TC-14-N07: Entity with No Telemetry Data
- **Priority**: Medium
- **Preconditions**: Entity exists but has never received telemetry.
- **Test Data**: EntityId of entity with no data.
- **Steps**:
  1. Send GET /api/telemetry/{entityId}/latest.
  2. Verify empty array returned.
  3. Send GET /api/telemetry/{entityId}/keys.
  4. Verify empty array returned.
- **Expected Result**: Empty arrays (no data, not an error).
