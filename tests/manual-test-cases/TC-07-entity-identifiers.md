# TC-07: Entity Identifiers — Test Cases

## Overview
- **Module**: Entity Identifier Management (Physical IDs)
- **API Endpoints**: 4
- **Frontend Pages**: /assets (Entity Explorer — Identifiers tab)
- **Permissions**: ASSET_VIEW (read/lookup), ASSET_IDENTIFIER_MANAGE (create/delete)
- **Reauth Actions**: CREATE_ASSET_IDENTIFIER, DELETE_ASSET_IDENTIFIER
- **Identifier Types**: QR, BARCODE, RFID, NFC, MANUAL
- **Key Constraint**: `identifierValue` is globally unique across all entities

---

## Positive Test Cases

### TC-07-P01: Create QR Identifier
- **Priority**: High
- **Preconditions**: Entity instance exists, verification token obtained
- **Test Data**: `{ "assetId": "<uuid>", "identifierType": "QR", "identifierValue": "QR-SENSOR-001", "label": "Main QR Code", "isPrimary": true }`
- **Steps**:
  1. Obtain verification token
  2. Send POST /api/assets/identifiers
  3. Verify response status 201
  4. Verify all fields stored correctly
- **Expected Result**: 201 Created with QR identifier, isPrimary=true

### TC-07-P02: Create BARCODE Identifier
- **Priority**: Medium
- **Preconditions**: Entity instance exists, verification token obtained
- **Test Data**: `{ "assetId": "<uuid>", "identifierType": "BARCODE", "identifierValue": "BC-123456789012", "label": "Asset Barcode" }`
- **Steps**:
  1. Create BARCODE identifier
  2. Verify creation
- **Expected Result**: 201 Created with BARCODE type

### TC-07-P03: Create RFID Identifier
- **Priority**: Medium
- **Preconditions**: Entity instance exists, verification token obtained
- **Test Data**: `{ "assetId": "<uuid>", "identifierType": "RFID", "identifierValue": "RFID-E2003412AB", "label": "RFID Tag" }`
- **Steps**:
  1. Create RFID identifier
  2. Verify creation
- **Expected Result**: 201 Created with RFID type

### TC-07-P04: Create NFC Identifier
- **Priority**: Medium
- **Preconditions**: Entity instance exists, verification token obtained
- **Test Data**: `{ "assetId": "<uuid>", "identifierType": "NFC", "identifierValue": "NFC-04:A2:D1:82:3B:2A:80", "label": "NFC Tag" }`
- **Steps**:
  1. Create NFC identifier
  2. Verify creation
- **Expected Result**: 201 Created with NFC type

### TC-07-P05: Create MANUAL Identifier
- **Priority**: Medium
- **Preconditions**: Entity instance exists, verification token obtained
- **Test Data**: `{ "assetId": "<uuid>", "identifierType": "MANUAL", "identifierValue": "INV-2024-00142", "label": "Inventory Number" }`
- **Steps**:
  1. Create MANUAL identifier
  2. Verify creation
- **Expected Result**: 201 Created with MANUAL type

### TC-07-P06: Lookup Entity by Identifier Value
- **Priority**: High
- **Preconditions**: Identifier "QR-SENSOR-001" exists
- **Test Data**: GET /api/assets/identifiers/lookup/QR-SENSOR-001
- **Steps**:
  1. Send GET /api/assets/identifiers/lookup/QR-SENSOR-001
  2. Verify response returns the linked entity details
- **Expected Result**: 200 OK with entity + identifier details

### TC-07-P07: List Identifiers by Entity
- **Priority**: High
- **Preconditions**: Entity has multiple identifiers
- **Test Data**: `?assetId=<uuid>`
- **Steps**:
  1. Send GET /api/assets/identifiers?assetId=<uuid>
  2. Verify all identifiers for that entity are returned
  3. Each has id, assetId, identifierType, identifierValue, label, isPrimary
- **Expected Result**: 200 OK with array of identifiers for the entity

### TC-07-P08: List Identifiers by Type
- **Priority**: Medium
- **Preconditions**: Identifiers of different types exist
- **Test Data**: `?type=QR`
- **Steps**:
  1. Send GET /api/assets/identifiers?type=QR
  2. Verify all returned identifiers are QR type
- **Expected Result**: 200 OK with only QR identifiers

### TC-07-P09: Delete Identifier
- **Priority**: High
- **Preconditions**: Identifier exists, verification token obtained
- **Test Data**: Identifier UUID
- **Steps**:
  1. Obtain verification token
  2. Send DELETE /api/assets/identifiers/:id
  3. Verify response `{ success: true }`
  4. Lookup the deleted identifier value — should return 404
- **Expected Result**: 200 OK, identifier removed, lookup returns 404

### TC-07-P10: Set isPrimary Flag
- **Priority**: Medium
- **Preconditions**: Entity instance exists
- **Test Data**: `{ "assetId": "<uuid>", "identifierType": "QR", "identifierValue": "QR-PRIMARY-001", "isPrimary": true }`
- **Steps**:
  1. Create identifier with isPrimary=true
  2. Verify isPrimary is true in response
  3. List identifiers for entity and verify isPrimary flag
- **Expected Result**: 201 with isPrimary=true

---

## Negative Test Cases

### TC-07-N01: Create Duplicate identifierValue (Global Uniqueness)
- **Priority**: High
- **Preconditions**: Identifier "QR-SENSOR-001" already exists on any entity
- **Test Data**: `{ "assetId": "<different_uuid>", "identifierType": "BARCODE", "identifierValue": "QR-SENSOR-001" }`
- **Steps**:
  1. Attempt to create identifier with same value on different entity
  2. Verify response is 409 Conflict
- **Expected Result**: 409 — identifierValue must be globally unique

### TC-07-N02: Create with Invalid Identifier Type
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "assetId": "<uuid>", "identifierType": "BLUETOOTH", "identifierValue": "BT-001" }`
- **Steps**:
  1. Attempt creation with unsupported type
  2. Verify 400
- **Expected Result**: 400 VALIDATION_ERROR — invalid identifier type

### TC-07-N03: Create for Non-Existent Entity
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "assetId": "00000000-0000-0000-0000-000000000000", "identifierType": "QR", "identifierValue": "QR-GHOST" }`
- **Steps**:
  1. Attempt creation for non-existent entity
  2. Verify 404
- **Expected Result**: 404 — entity not found

### TC-07-N04: Create Without ASSET_IDENTIFIER_MANAGE Permission
- **Priority**: High
- **Preconditions**: Logged in as VIEWER (no ASSET_IDENTIFIER_MANAGE)
- **Test Data**: Any valid identifier payload
- **Steps**:
  1. Login as VIEWER
  2. Attempt POST /api/assets/identifiers
  3. Verify 403
- **Expected Result**: 403 Forbidden

### TC-07-N05: Lookup Non-Existent Value
- **Priority**: Medium
- **Preconditions**: None
- **Test Data**: GET /api/assets/identifiers/lookup/NONEXISTENT-VALUE-XYZ
- **Steps**:
  1. Lookup a value that does not exist
  2. Verify 404
- **Expected Result**: 404 — identifier not found

### TC-07-N06: Delete Non-Existent Identifier
- **Priority**: Low
- **Preconditions**: Verification token obtained
- **Test Data**: DELETE /api/assets/identifiers/00000000-0000-0000-0000-000000000000
- **Steps**:
  1. Attempt to delete non-existent identifier
  2. Verify 404
- **Expected Result**: 404 Not Found

### TC-07-N07: Create Identifier with Empty Value
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "assetId": "<uuid>", "identifierType": "QR", "identifierValue": "" }`
- **Steps**:
  1. Attempt creation with empty identifier value
  2. Verify 400
- **Expected Result**: 400 VALIDATION_ERROR

### TC-07-N08: Create Identifier Missing Required Fields
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "assetId": "<uuid>" }` (missing identifierType and identifierValue)
- **Steps**:
  1. Attempt POST with missing required fields
  2. Verify 400
- **Expected Result**: 400 VALIDATION_ERROR with missing field details
