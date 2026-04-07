# EG-13: Unified Namespace (UNS) -- Execution Guide

## Prerequisites
- **App URL**: http://34.232.224.0
- **API Base**: http://localhost:3000/api
- **SUPER_ADMIN Credentials**: superadmin / Admin@123
- **Entities**: At least 2-3 entities in a parent-child hierarchy with UNS mappings
- **Browser**: Chrome or Firefox

## Setup: Obtain Auth Token and Entity IDs

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

# Find entities with UNS mappings
sudo -u postgres psql digilog_db -c "SELECT entity_id, uns_path, is_overridden FROM uns_mappings ORDER BY uns_path LIMIT 10;"

ENTITY_ID="<pick-an-entity-id-from-above>"
```

---

## Test Execution

### Test: TC-13-P01 -- Get Full UNS Tree

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/uns/tree \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Browser Steps:**
1. Navigate to http://34.232.224.0/config/uns.
2. Verify the UNS tree displays hierarchically.

**Expected Result:**
- Array of tree nodes with hierarchical structure.

**Pass/Fail:**
- [ ] Response is array
- [ ] Tree reflects ISA-95 hierarchy
- [ ] Each node has path and entity info

---

### Test: TC-13-P02 -- Get Entity UNS Mapping

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/uns/entity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "id": "mapping-uuid",
  "entityId": "entity-uuid",
  "unsPath": "site/area/device-name",
  "isOverridden": false,
  "entityName": "Device-01",
  "createdAt": "2026-03-01T...",
  "updatedAt": "2026-03-01T..."
}
```

**Pass/Fail:**
- [ ] Response has unsPath
- [ ] entityName matches entity
- [ ] isOverridden field present

---

### Test: TC-13-P03 -- Override Entity UNS Path

**API (curl):**
```bash
# Get current path first
CURRENT_PATH=$(curl -s -X GET "http://localhost:3000/api/uns/entity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.unsPath')

echo "Current path: $CURRENT_PATH"

# Override
curl -s -X PUT "http://localhost:3000/api/uns/entity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"unsPath": "site/custom-area/custom-device"}' | jq .

# Verify
curl -s -X GET "http://localhost:3000/api/uns/entity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.isOverridden, .unsPath'
```

**Expected Result:**
- Override returns updated mapping with `isOverridden: true`

**Restore (optional):**
```bash
curl -s -X PUT "http://localhost:3000/api/uns/entity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"unsPath\": \"$CURRENT_PATH\"}" | jq .
```

**Pass/Fail:**
- [ ] Override successful
- [ ] isOverridden becomes true
- [ ] Audit entry UNS_PATH_OVERRIDDEN created

---

### Test: TC-13-P04 -- Generate Move Impact Report

**API (curl):**
```bash
# Find an entity with children
PARENT_ID=$(sudo -u postgres psql -t -A digilog_db -c "SELECT id FROM asset_instances WHERE parent_id IS NOT NULL AND is_active = true LIMIT 1;")

curl -s -X POST "http://localhost:3000/api/uns/entity/$PARENT_ID/move" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newParentId": null}' | jq .
```

**Expected Result:**
```json
{
  "impact": [
    {
      "entityId": "...",
      "entityName": "...",
      "currentPath": "site/area/line/device",
      "newPath": "device"
    }
  ],
  "summary": {
    "totalAffected": 3,
    "directChildren": 2,
    "descendants": 2
  }
}
```

**Pass/Fail:**
- [ ] Impact array shows affected entities
- [ ] Each entry has currentPath and newPath
- [ ] Summary counts correct

---

### Test: TC-13-P06 -- Search UNS by Wildcard

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/uns/search?path=site/*" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Array of matching UNS mappings.

**Pass/Fail:**
- [ ] Response is array
- [ ] Each result has unsPath, entityId, entityName
- [ ] All paths match the wildcard pattern

---

### Test: TC-13-N01 -- Get UNS Tree Without Sufficient Role

**API (curl):**
```bash
# Login as OPERATOR
OP_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator1","password":"YourPassword123"}' | jq -r '.token')

curl -s -X GET http://localhost:3000/api/uns/tree \
  -H "Authorization: Bearer $OP_TOKEN" | jq .
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status 403

---

### Test: TC-13-N03 -- Get UNS Mapping for Non-Mapped Entity

**API (curl):**
```bash
# Find entity without UNS mapping
NO_MAPPING_ID=$(sudo -u postgres psql -t -A digilog_db -c "SELECT ai.id FROM asset_instances ai LEFT JOIN uns_mappings um ON ai.id = um.entity_id WHERE um.id IS NULL AND ai.is_active = true LIMIT 1;")

curl -s -X GET "http://localhost:3000/api/uns/entity/$NO_MAPPING_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 404 `{ "error": "UNS mapping not found for this entity" }`

**Pass/Fail:**
- [ ] Response status 404
- [ ] Error message matches

---

### Test: TC-13-N07 -- Access Without Authentication

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/uns/tree
```

**Expected Result:**
- 401

**Pass/Fail:**
- [ ] Response status 401


> **Phase 2 (Digital FMS):** UNS applies to filter entities. Filters map to ISA-95 hierarchy paths using same auto-generation and override rules.


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
