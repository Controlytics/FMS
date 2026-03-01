# Template API

The Template API provides CRUD operations for asset templates — the blueprints that define entity structure, telemetry schemas, alarm rules, checklist definitions, and data ingestion settings.

---

## Endpoints

### GET /api/assets/templates

List templates with optional search and pagination.

```bash
curl "http://your-server/api/assets/templates?search=sensor&page=1&limit=50" \
  -H "Authorization: Bearer USER_TOKEN"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Filter by name (case-insensitive) |
| `isActive` | string | `"true"` or `"false"` |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 50) |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Temperature Sensor",
      "description": "Industrial temperature sensor",
      "category": "Sensor",
      "icon": "thermometer",
      "version": 3,
      "dataIngestionEnabled": true,
      "transportType": "MQTT",
      "credentialType": "TOKEN",
      "isActive": true,
      "_count": { "instances": 12 }
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 50,
  "totalPages": 1
}
```

**Permission:** `ASSET_VIEW`

---

### GET /api/assets/templates/:id

Get a single template by UUID, including instance count.

```bash
GET /api/assets/templates/abc-123
```

**Permission:** `ASSET_VIEW`

---

### POST /api/assets/templates

Create a new template. Auto-creates version 1 snapshot.

**Request:**
```bash
curl -X POST "http://your-server/api/assets/templates" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Temperature Sensor",
    "description": "Industrial temperature sensor",
    "category": "Sensor",
    "icon": "thermometer",
    "attributeSchema": [
      { "key": "location", "label": "Location", "type": "string", "required": true },
      { "key": "firmware_version", "label": "Firmware", "type": "string" }
    ],
    "statusLifecycle": [
      { "name": "Active", "color": "#22c55e", "transitions": ["Maintenance", "Inactive"] },
      { "name": "Maintenance", "color": "#f59e0b", "transitions": ["Active", "Inactive"] },
      { "name": "Inactive", "color": "#ef4444", "transitions": ["Active"] }
    ],
    "alarmRules": [
      { "alarmType": "HIGH_TEMP", "severity": "CRITICAL", "condition": "temperature > 100" }
    ],
    "checklistSchema": [
      { "id": "q_0", "text": "Is the sensor clean?", "type": "YES_NO", "required": true }
    ],
    "dataIngestionEnabled": true,
    "transportType": "MQTT",
    "credentialType": "TOKEN",
    "inactivityTimeout": 300,
    "defaultMaxDataRate": 60,
    "defaultRuleChainId": "RULE_CHAIN_UUID"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Template name (unique) |
| `description` | string | No | Human-readable description |
| `category` | string | No | One of: General, Equipment, Room, Building, Sensor, Vehicle, Utility, Process, Storage, Laboratory |
| `icon` | string | No | Icon identifier for UI |
| `attributeSchema` | array | No | Attribute field definitions |
| `statusLifecycle` | array | No | Status states with allowed transitions |
| `alarmRules` | array | No | Alarm rule definitions |
| `checklistSchema` | array | No | Checklist question definitions |
| `expectedIdentifiers` | array | No | Expected identifier types (QR, barcode, etc.) |
| `expectedRelationships` | array | No | Expected relationship type definitions |
| `maxParentConnections` | integer | No | 0=disallowed, 1=single parent, 2+=multiple parents |
| `maxConnections` | integer | No | Max total connections (0=unlimited) |
| `dataIngestionEnabled` | boolean | No | Enable data ingestion for entities |
| `transportType` | string | No | `MQTT`, `HTTP`, or `WEBSOCKET` |
| `credentialType` | string | No | `TOKEN`, `BASIC`, or `X509` |
| `inactivityTimeout` | integer | No | Seconds before marking device offline |
| `defaultMaxDataRate` | integer | No | Max messages per rate-limit window |
| `autoProvision` | boolean | No | Auto-create credentials on first connect |
| `defaultRuleChainId` | UUID | No | Default rule chain for processing |

> **Note:** Creating or updating a template requires **re-authentication** (password verification). X509 credentials are only valid with MQTT transport.

**Permission:** `ASSET_TEMPLATE_CREATE`

---

### PUT /api/assets/templates/:id

Update a template. Increments the version number and creates a new version snapshot.

```bash
curl -X PUT "http://your-server/api/assets/templates/abc-123" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Temperature Sensor v2", "alarmRules": [...] }'
```

All fields from `POST` are accepted as partial updates.

**Permission:** `ASSET_TEMPLATE_UPDATE`

---

### DELETE /api/assets/templates/:id

Soft-delete a template (sets `isActive=false`).

```bash
curl -X DELETE "http://your-server/api/assets/templates/abc-123" \
  -H "Authorization: Bearer USER_TOKEN"
```

**Permission:** `ASSET_TEMPLATE_DELETE`

---

### GET /api/assets/templates/:id/versions

List all version snapshots for a template, ordered by version number descending.

```bash
GET /api/assets/templates/abc-123/versions
```

**Response (200):**
```json
[
  {
    "id": "version-uuid",
    "templateId": "abc-123",
    "versionNumber": 3,
    "snapshot": { "name": "Temperature Sensor v2", "attributeSchema": [...] },
    "changeNotes": "Added humidity attribute",
    "createdAt": "2026-03-01T10:00:00Z",
    "createdBy": "admin"
  }
]
```

**Permission:** `ASSET_VIEW`

---

## Template Schema Reference

### Attribute Schema

```json
[
  {
    "key": "location",
    "label": "Location",
    "type": "string",
    "required": true,
    "defaultValue": ""
  },
  {
    "key": "max_temp",
    "label": "Max Temperature",
    "type": "number",
    "required": false,
    "defaultValue": 100
  }
]
```

Supported types: `string`, `number`, `boolean`, `date`, `select`

### Status Lifecycle

```json
[
  {
    "name": "Active",
    "color": "#22c55e",
    "transitions": ["Maintenance", "Inactive"]
  }
]
```

### Checklist Schema

```json
[
  { "id": "q_0", "text": "Is the sensor clean?", "type": "YES_NO", "required": true },
  { "id": "q_1", "text": "Current reading", "type": "NUMBER", "required": true },
  { "id": "q_2", "text": "Upload photo", "type": "PHOTO", "required": false },
  { "id": "q_3", "text": "Additional notes", "type": "TEXT", "required": false },
  { "id": "q_4", "text": "Select condition", "type": "MULTIPLE_CHOICE", "options": ["Good", "Fair", "Poor"], "required": true }
]
```

Question types: `YES_NO`, `TEXT`, `NUMBER`, `MULTIPLE_CHOICE`, `PHOTO`

---

## Next Steps

- [Entity API](entities.md) — Entity instance management
- [Telemetry API](telemetry.md) — Data ingestion endpoints
- [Asset Templates Guide](../user-guide/templates/asset-templates.md) — Template concepts
