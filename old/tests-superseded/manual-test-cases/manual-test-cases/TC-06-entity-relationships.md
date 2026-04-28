# TC-06: Entity Relationships — Test Cases

## Overview
- **Module**: Entity Relationship Management (Bidirectional)
- **API Endpoints**: 3
- **Frontend Pages**: /assets (Entity Explorer — Relationships tab)
- **Permissions**: ASSET_VIEW (read), ASSET_RELATIONSHIP_MANAGE (create/delete)
- **Reauth Actions**: CREATE_ASSET_RELATIONSHIP, DELETE_ASSET_RELATIONSHIP
- **Relationship Types**: CONTAINS/CONTAINED_IN, FEEDS/FED_BY, DEPENDS_ON/DEPENDED_ON_BY, BACKS_UP/BACKED_UP_BY, MONITORS/MONITORED_BY, CONNECTED_TO (symmetric), CUSTOM

---

## Positive Test Cases

### TC-06-P01: Create CONTAINS Relationship (Auto-Inverse)
- **Priority**: High
- **Preconditions**: Two entity instances exist (Parent A, Child B), verification token obtained
- **Test Data**: `{ "sourceAssetId": "<A_uuid>", "targetAssetId": "<B_uuid>", "relationshipType": "CONTAINS" }`
- **Steps**:
  1. Obtain verification token
  2. Send POST /api/assets/relationships
  3. Verify response includes `data` (forward) and `inverse` (auto-created CONTAINED_IN)
  4. Verify `connectionInfo` is in response
- **Expected Result**: 201 with forward CONTAINS + auto-created inverse CONTAINED_IN, `connectionInfo` with used/allowed/remaining

### TC-06-P02: Create FEEDS/FED_BY Relationship
- **Priority**: Medium
- **Preconditions**: Two instances exist
- **Test Data**: `{ "sourceAssetId": "<A>", "targetAssetId": "<B>", "relationshipType": "FEEDS" }`
- **Steps**:
  1. Create FEEDS relationship
  2. Verify inverse FED_BY auto-created
- **Expected Result**: 201 with FEEDS + auto FED_BY

### TC-06-P03: Create DEPENDS_ON Relationship
- **Priority**: Medium
- **Preconditions**: Two instances exist
- **Test Data**: `{ "sourceAssetId": "<A>", "targetAssetId": "<B>", "relationshipType": "DEPENDS_ON" }`
- **Steps**:
  1. Create DEPENDS_ON relationship
  2. Verify inverse DEPENDED_ON_BY auto-created
- **Expected Result**: 201 with DEPENDS_ON + auto DEPENDED_ON_BY

### TC-06-P04: Create MONITORS Relationship
- **Priority**: Medium
- **Preconditions**: Two instances exist
- **Test Data**: `{ "sourceAssetId": "<A>", "targetAssetId": "<B>", "relationshipType": "MONITORS" }`
- **Steps**:
  1. Create MONITORS relationship
  2. Verify inverse MONITORED_BY auto-created
- **Expected Result**: 201 with MONITORS + auto MONITORED_BY

### TC-06-P05: Create CONNECTED_TO (Symmetric) Relationship
- **Priority**: Medium
- **Preconditions**: Two instances exist
- **Test Data**: `{ "sourceAssetId": "<A>", "targetAssetId": "<B>", "relationshipType": "CONNECTED_TO" }`
- **Steps**:
  1. Create CONNECTED_TO relationship
  2. Verify inverse is also CONNECTED_TO (symmetric)
- **Expected Result**: 201 with CONNECTED_TO in both directions

### TC-06-P06: List Relationships Filtered by Entity
- **Priority**: High
- **Preconditions**: Relationships created
- **Test Data**: `?assetId=<A_uuid>`
- **Steps**:
  1. Send GET /api/assets/relationships?assetId=<uuid>
  2. Verify all returned relationships involve that entity (as source or target)
  3. Each includes sourceAsset and targetAsset name info
- **Expected Result**: 200 OK with array of relationships for the entity

### TC-06-P07: List Relationships Filtered by Type
- **Priority**: Medium
- **Preconditions**: Relationships of various types exist
- **Test Data**: `?type=CONTAINS`
- **Steps**:
  1. Send GET /api/assets/relationships?type=CONTAINS
  2. Verify all returned relationships are of type CONTAINS
- **Expected Result**: 200 OK with only CONTAINS type relationships

### TC-06-P08: Delete Relationship (Both Sides Deleted)
- **Priority**: High
- **Preconditions**: Relationship pair exists (forward + inverse)
- **Test Data**: Relationship ID (either forward or inverse)
- **Steps**:
  1. Note the forward relationship ID and inverse ID
  2. Obtain verification token
  3. Send DELETE /api/assets/relationships/:id with forward ID
  4. Verify response `{ success: true }`
  5. GET relationships for both entities — verify both forward and inverse are gone
- **Expected Result**: 200 OK, both forward and inverse deleted

### TC-06-P09: Verify connectionInfo in Response
- **Priority**: Medium
- **Preconditions**: Entity with maxConnections limit on template
- **Test Data**: Create relationship and check response
- **Steps**:
  1. Create a relationship
  2. Check response `connectionInfo` field
  3. Verify it shows used, allowed, remaining counts
- **Expected Result**: `connectionInfo: { source: { used, allowed, remaining }, target: { used, allowed, remaining } }`

### TC-06-P10: Create Relationship with Notes and Custom Label
- **Priority**: Low
- **Preconditions**: Two instances exist
- **Test Data**: `{ "sourceAssetId": "<A>", "targetAssetId": "<B>", "relationshipType": "CUSTOM", "customLabel": "Powers", "notes": "Primary power supply" }`
- **Steps**:
  1. Create CUSTOM relationship with notes and customLabel
  2. Verify both fields stored
- **Expected Result**: 201 with customLabel and notes preserved

---

## Negative Test Cases

### TC-06-N01: Create Circular CONTAINS (Cycle Detection)
- **Priority**: High
- **Preconditions**: A CONTAINS B, B CONTAINS C exist
- **Test Data**: `{ "sourceAssetId": "<C>", "targetAssetId": "<A>", "relationshipType": "CONTAINS" }` (C -> A creates cycle)
- **Steps**:
  1. Create chain: A CONTAINS B, B CONTAINS C
  2. Attempt C CONTAINS A (cycle)
  3. Verify cycle detection blocks the request
- **Expected Result**: 400 or 409 — circular CONTAINS detected

### TC-06-N02: Exceed maxConnections Limit
- **Priority**: High
- **Preconditions**: Entity template has maxConnections=2, entity already has 2 relationships
- **Test Data**: Attempt to create 3rd relationship
- **Steps**:
  1. Create template with maxConnections=2
  2. Create instance from that template
  3. Create 2 relationships
  4. Attempt 3rd relationship
  5. Verify error with connectionInfo
- **Expected Result**: 400 with error about maxConnections exceeded, includes connectionInfo

### TC-06-N03: Relate Entity to Itself
- **Priority**: High
- **Preconditions**: Entity instance exists
- **Test Data**: `{ "sourceAssetId": "<A>", "targetAssetId": "<A>", "relationshipType": "CONTAINS" }`
- **Steps**:
  1. Attempt to create relationship with same source and target
  2. Verify error
- **Expected Result**: 400 — cannot create self-referencing relationship

### TC-06-N04: Create Duplicate Relationship
- **Priority**: Medium
- **Preconditions**: Relationship A->B CONTAINS already exists
- **Test Data**: `{ "sourceAssetId": "<A>", "targetAssetId": "<B>", "relationshipType": "CONTAINS" }` (duplicate)
- **Steps**:
  1. Attempt to create same relationship again
  2. Verify error
- **Expected Result**: 409 — relationship already exists

### TC-06-N05: Create with Non-Existent Entity
- **Priority**: Medium
- **Preconditions**: None
- **Test Data**: `{ "sourceAssetId": "00000000-0000-0000-0000-000000000000", "targetAssetId": "<valid>", "relationshipType": "CONTAINS" }`
- **Steps**:
  1. Attempt creation with non-existent source entity
  2. Verify 404
- **Expected Result**: 404 — entity not found

### TC-06-N06: Create Without ASSET_RELATIONSHIP_MANAGE Permission
- **Priority**: High
- **Preconditions**: Logged in as user without ASSET_RELATIONSHIP_MANAGE
- **Test Data**: Any valid relationship payload
- **Steps**:
  1. Login as VIEWER
  2. Attempt POST /api/assets/relationships
  3. Verify 403
- **Expected Result**: 403 Forbidden

### TC-06-N07: Delete Non-Existent Relationship
- **Priority**: Low
- **Preconditions**: None
- **Test Data**: DELETE /api/assets/relationships/00000000-0000-0000-0000-000000000000
- **Steps**:
  1. Attempt to delete non-existent relationship
  2. Verify 404
- **Expected Result**: 404 Not Found

### TC-06-N08: Invalid Relationship Type
- **Priority**: Medium
- **Preconditions**: Two instances exist
- **Test Data**: `{ "sourceAssetId": "<A>", "targetAssetId": "<B>", "relationshipType": "INVALID_TYPE_XYZ" }`
- **Steps**:
  1. Attempt creation with invalid relationship type
  2. Verify 400
- **Expected Result**: 400 VALIDATION_ERROR


---

## Phase 2 Notes

- Entity relationships apply to filter instances the same way as other entities. Filters can have CONTAINS, MONITORS, and other relationship types.
- Filter-to-AHU relationships can be modeled using CONTAINED_IN relationship type.
- Equipment group assignments are managed separately via /api/equipment-groups endpoints.


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
