# Entity API

The Entity API provides CRUD operations for entity instances, relationships, and identifiers.

---

## Entity Instances

### POST /api/assets/instances

Create a new entity from a template.

**Request:**
```bash
curl -X POST "http://your-server/api/assets/instances" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Warehouse-Sensor-01",
    "templateId": "TEMPLATE_UUID",
    "description": "Temperature sensor in Building A",
    "status": "Active",
    "parentId": "PARENT_ENTITY_UUID",
    "attributes": {
      "location": "Building A, Room 101",
      "firmware_version": "1.0.0"
    }
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Entity display name |
| `templateId` | UUID | Yes | Asset template to instantiate |
| `description` | string | No | Human-readable description |
| `status` | string | No | Initial status (default from template) |
| `parentId` | UUID | No | Parent entity for hierarchy placement |
| `attributes` | object | No | Key-value pairs matching template schema |
| `telemetryConfig` | object | No | Telemetry configuration overrides |
| `customAttributes` | object | No | Free-form custom attributes |

**Response (201):**
```json
{
  "id": "abc-123",
  "name": "Warehouse-Sensor-01",
  "templateId": "TEMPLATE_UUID",
  "templateVersion": 1,
  "status": "Active",
  "isActive": true,
  "parentId": "PARENT_ENTITY_UUID",
  "attributes": { "location": "Building A, Room 101" },
  "createdAt": "2026-03-01T08:00:00Z"
}
```

> **Note:** If the template has **Data Ingestion Enabled**, creating an entity automatically provisions a device access token, connectivity status record, and UNS mapping.

**Permission:** `ASSET_CREATE`

---

### GET /api/assets/instances

List entities with search, filter, and pagination.

```bash
GET /api/assets/instances?search=sensor&templateId=UUID&status=Active&page=1&limit=20
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Filter by name (case-insensitive contains) |
| `templateId` | UUID | Filter by template |
| `status` | string | Filter by status |
| `parentId` | UUID or `null` | Filter by parent (use `null` for root entities) |
| `isActive` | boolean | Filter by active/inactive |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |

**Response (200):**
```json
{
  "data": [ ... ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

**Permission:** `ASSET_VIEW`

---

### GET /api/assets/instances/tree

Get the full entity tree for the hierarchy view.

```bash
GET /api/assets/instances/tree
```

Returns a flat array of entities with `parentId` fields for client-side tree construction.

**Permission:** `ASSET_VIEW`

---

### GET /api/assets/instances/:id

Get entity details including template, relationships, and identifiers.

```bash
GET /api/assets/instances/abc-123
```

**Permission:** `ASSET_VIEW`

---

### PUT /api/assets/instances/:id

Update an entity's properties.

```bash
curl -X PUT "http://your-server/api/assets/instances/abc-123" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Warehouse-Sensor-01-Updated",
    "status": "Maintenance",
    "attributes": { "location": "Building B" }
  }'
```

> **Note:** Changing the `parentId` triggers automatic relationship cleanup, new relationship creation, UNS path cascade update, and audit logging.

**Permission:** `ASSET_UPDATE`

---

### PATCH /api/assets/instances/:id/status

Change entity status.

```bash
curl -X PATCH "http://your-server/api/assets/instances/abc-123/status" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "Maintenance"}'
```

**Permission:** `ASSET_UPDATE`

---

### DELETE /api/assets/instances/:id

Soft-delete an entity and all descendants.

```bash
curl -X DELETE "http://your-server/api/assets/instances/abc-123" \
  -H "Authorization: Bearer USER_TOKEN"
```

**Cascade cleanup includes:**
- Descendant entities (soft-deleted)
- Relationships (CONTAINS/CONTAINED_IN pairs)
- Identifiers
- Device credentials
- Connectivity status records
- UNS mappings
- QR codes
- Latest telemetry cache
- Data streams

**Permission:** `ASSET_DELETE`

---

## Relationships

### GET /api/assets/relationships

```bash
GET /api/assets/relationships?assetId=abc-123&type=CONTAINS
```

### POST /api/assets/relationships

```bash
curl -X POST "http://your-server/api/assets/relationships" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAssetId": "PARENT_UUID",
    "targetAssetId": "CHILD_UUID",
    "relationshipType": "CONTAINS"
  }'
```

The inverse relationship (CONTAINED_IN) is created automatically.

**Permission:** `ASSET_RELATIONSHIP_MANAGE`

---

## Identifiers

Entity identifiers allow looking up entities by QR code, barcode, RFID tag, NFC tag, or manual ID.

### POST /api/assets/identifiers

```bash
curl -X POST "http://your-server/api/assets/identifiers" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "abc-123",
    "type": "QR_CODE",
    "value": "WH-SENSOR-001"
  }'
```

| Identifier Type | Description |
|-----------------|-------------|
| `QR_CODE` | QR code scan value |
| `BARCODE` | Barcode scan value |
| `RFID` | RFID tag ID |
| `NFC` | NFC tag ID |
| `MANUAL` | Manually entered identifier |

### GET /api/assets/identifiers/lookup/:value

Look up an entity by any identifier value:

```bash
GET /api/assets/identifiers/lookup/WH-SENSOR-001
```

**Permission:** `ASSET_VIEW`

---

## Next Steps

- [Template API](templates.md) — Asset template management
- [Telemetry API](telemetry.md) — Data ingestion and querying
- [Authentication API](authentication.md) — Login and session management
