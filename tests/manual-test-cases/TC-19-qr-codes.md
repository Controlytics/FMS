# TC-19: QR Codes — Test Cases

## Overview
- **Module**: QR Code Management
- **API Endpoints**: 4 (POST /:entityId/generate, GET /:entityId, GET /:entityId/svg, DELETE /:entityId)
- **Frontend Pages**: /assets (QR Code tab in entity detail panel)
- **Permissions**: SUPER_ADMIN/ADMIN/SUPERVISOR (generate), ASSET_VIEW (get), SUPER_ADMIN/ADMIN (delete)
- **Prefix**: /api/qr

---

## Positive Test Cases

### TC-19-P01: Generate QR Code for Entity (Default Settings)
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN/ADMIN/SUPERVISOR, entity instance exists
- **Test Data**: Entity UUID, default body (no size/includeLabel specified)
- **Steps**:
  1. Send POST /api/qr/:entityId/generate with empty body or `{}`
  2. Verify response status is 200
  3. Verify response contains `id` (UUID)
  4. Verify response contains `entityId` matching the request
  5. Verify response contains `qrData` (URL format: `<appUrl>/m/<entityId>?action=dashboard`)
  6. Verify response contains `svgData` (SVG string starting with `<svg`)
  7. Verify response contains `size` = "MEDIUM" (default)
  8. Verify response contains `includeLabel` = false (default)
- **Expected Result**: 200 OK with QR code record including SVG data, default MEDIUM size, action=dashboard

### TC-19-P02: Generate QR Code with Custom Size and Label
- **Priority**: Medium
- **Preconditions**: Logged in as SUPERVISOR+, entity exists
- **Test Data**:
  ```json
  {
    "size": "LARGE",
    "includeLabel": true,
    "action": "checklist"
  }
  ```
- **Steps**:
  1. Send POST /api/qr/:entityId/generate with size=LARGE, includeLabel=true, action=checklist
  2. Verify response status is 200
  3. Verify `size` is "LARGE"
  4. Verify `includeLabel` is true
  5. Verify `qrData` URL contains `?action=checklist`
  6. Verify SVG data contains the entity name as a text label
- **Expected Result**: 200 OK with LARGE QR code including text label, linking to checklist action

### TC-19-P03: Generate QR Code with SMALL Size
- **Priority**: Low
- **Preconditions**: Logged in as SUPERVISOR+, entity exists
- **Test Data**: `{ "size": "SMALL", "action": "history" }`
- **Steps**:
  1. Send POST /api/qr/:entityId/generate with size=SMALL, action=history
  2. Verify response status is 200
  3. Verify `size` is "SMALL"
  4. Verify `qrData` URL contains `?action=history`
  5. Verify SVG has width="150" (SMALL pixel size)
- **Expected Result**: 200 OK with SMALL QR code linking to history action

### TC-19-P04: Get QR Code for Entity
- **Priority**: High
- **Preconditions**: QR code already generated for the entity (TC-19-P01)
- **Test Data**: Entity UUID
- **Steps**:
  1. Send GET /api/qr/:entityId
  2. Verify response status is 200
  3. Verify response contains `id`, `entityId`, `qrData`, `imagePath`, `svgData`, `size`, `includeLabel`, `createdAt`, `updatedAt`
  4. Verify `entityId` matches the request parameter
- **Expected Result**: 200 OK with full QR code record including timestamps

### TC-19-P05: Get QR Code as SVG Image
- **Priority**: Medium
- **Preconditions**: QR code exists for entity
- **Test Data**: Entity UUID
- **Steps**:
  1. Send GET /api/qr/:entityId/svg
  2. Verify response status is 200
  3. Verify Content-Type header is "image/svg+xml"
  4. Verify response body starts with `<svg`
  5. Verify response body is valid SVG markup
- **Expected Result**: 200 OK with raw SVG content and correct content type header

### TC-19-P06: Re-generate QR Code (Upsert Behavior)
- **Priority**: High
- **Preconditions**: QR code already exists for entity (from TC-19-P01)
- **Test Data**: `{ "size": "LARGE", "includeLabel": true, "action": "checklist" }`
- **Steps**:
  1. Note the existing QR code id from GET /api/qr/:entityId
  2. Send POST /api/qr/:entityId/generate with different parameters
  3. Verify response status is 200
  4. Verify the `id` is the same as before (upsert, not duplicate)
  5. Verify `size` is now "LARGE" and `includeLabel` is now true
  6. Verify `qrData` URL now contains `?action=checklist`
- **Expected Result**: 200 OK — existing QR code record is updated (not duplicated)

### TC-19-P07: Delete QR Code
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN or ADMIN, QR code exists for entity
- **Test Data**: Entity UUID
- **Steps**:
  1. Verify QR code exists via GET /api/qr/:entityId (200)
  2. Send DELETE /api/qr/:entityId
  3. Verify response status is 200
  4. Verify response contains `deleted: true`
  5. Send GET /api/qr/:entityId and verify 404
- **Expected Result**: 200 OK, QR code deleted, subsequent GET returns 404

---

## Negative Test Cases

### TC-19-N01: Generate QR Code for Non-Existent Entity
- **Priority**: High
- **Preconditions**: Logged in as ADMIN
- **Test Data**: Non-existent UUID: `00000000-0000-0000-0000-000000000000`
- **Steps**:
  1. Send POST /api/qr/00000000-0000-0000-0000-000000000000/generate with `{}`
  2. Verify response status is 404
  3. Verify error is "NOT_FOUND"
- **Expected Result**: 404 Not Found — entity does not exist

### TC-19-N02: Get QR Code for Entity Without QR Code
- **Priority**: Medium
- **Preconditions**: Entity exists but has no QR code generated
- **Test Data**: Entity UUID with no QR code
- **Steps**:
  1. Send GET /api/qr/:entityId
  2. Verify response status is 404
  3. Verify error message indicates QR code not found for this entity
- **Expected Result**: 404 Not Found — "QR code not found for this entity"

### TC-19-N03: Delete Non-Existent QR Code
- **Priority**: Medium
- **Preconditions**: Logged in as ADMIN, entity has no QR code
- **Test Data**: Entity UUID with no QR code
- **Steps**:
  1. Send DELETE /api/qr/:entityId
  2. Verify response status is 404
  3. Verify error is "NOT_FOUND"
- **Expected Result**: 404 Not Found — QR code does not exist

### TC-19-N04: Generate QR Code Without Sufficient Role
- **Priority**: High
- **Preconditions**: Logged in as OPERATOR (not SUPERVISOR+)
- **Test Data**: Valid entity UUID
- **Steps**:
  1. Send POST /api/qr/:entityId/generate with OPERATOR token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — requires SUPER_ADMIN, ADMIN, or SUPERVISOR role

### TC-19-N05: Delete QR Code Without Admin Role
- **Priority**: Medium
- **Preconditions**: Logged in as SUPERVISOR or OPERATOR, QR code exists
- **Test Data**: Valid entity UUID with QR code
- **Steps**:
  1. Send DELETE /api/qr/:entityId with SUPERVISOR token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — deletion requires SUPER_ADMIN or ADMIN role

### TC-19-N06: Get SVG for Entity Without QR Code
- **Priority**: Low
- **Preconditions**: Entity exists but no QR code
- **Test Data**: Entity UUID without QR code
- **Steps**:
  1. Send GET /api/qr/:entityId/svg
  2. Verify response status is 404
  3. Verify error message mentions QR code SVG not found
- **Expected Result**: 404 Not Found — "QR code SVG not found for this entity"

### TC-19-N07: Access QR Code Endpoints Without Authentication
- **Priority**: High
- **Preconditions**: No JWT token
- **Test Data**: Valid entity UUID
- **Steps**:
  1. Send GET /api/qr/:entityId without Authorization header
  2. Verify response status is 401
- **Expected Result**: 401 Unauthorized — missing token


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

