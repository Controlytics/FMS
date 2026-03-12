# UNS API

The Unified Namespace (UNS) API provides 6 endpoints for viewing the namespace tree, managing entity UNS paths, performing cascade moves, and searching by wildcard patterns.

**Last Updated:** 2026-03-07

---

## Endpoints Summary

| Method | Endpoint | Role/Permission | Reauth | Description |
|--------|----------|----------------|--------|-------------|
| GET | `/api/uns/tree` | SUPER_ADMIN, ADMIN, SUPERVISOR | -- | Get full UNS tree |
| GET | `/api/uns/entity/:entityId` | ASSET_VIEW | -- | Get entity UNS mapping |
| PUT | `/api/uns/entity/:entityId` | SUPER_ADMIN | OVERRIDE_UNS_PATH | Override entity UNS path |
| POST | `/api/uns/entity/:entityId/move` | SUPER_ADMIN, ADMIN | -- | Generate move impact report |
| POST | `/api/uns/entity/:entityId/move/confirm` | SUPER_ADMIN, ADMIN | UPDATE_UNS_CONFIG | Confirm and execute cascade move |
| GET | `/api/uns/search` | ASSET_VIEW | -- | Search UNS by wildcard pattern |

---

## UNS Tree

### GET /api/uns/tree

Get the full Unified Namespace tree in hierarchical format.

```bash
curl "http://your-server/api/uns/tree" \
  -H "Authorization: Bearer USER_TOKEN"
```

Returns an array of tree nodes with nested children, ISA-95 level labels, entity names, and full UNS paths.

**Role Required:** `SUPER_ADMIN`, `ADMIN`, or `SUPERVISOR`

---

## Entity UNS Mapping

### GET /api/uns/entity/:entityId

Get the UNS mapping for a specific entity.

```bash
curl "http://your-server/api/uns/entity/ENTITY_UUID" \
  -H "Authorization: Bearer USER_TOKEN"
```

**Response (200):**
```json
{
  "id": "mapping-uuid",
  "entityId": "entity-uuid",
  "unsPath": "digilog/v1/acme/mumbai/packaging/line-1/tp-42",
  "isOverridden": false,
  "entityName": "Temperature Probe TP-42",
  "createdAt": "2026-03-01T08:00:00Z",
  "updatedAt": "2026-03-01T08:00:00Z"
}
```

**Permission:** `ASSET_VIEW`

---

### PUT /api/uns/entity/:entityId

Manually override the UNS path for an entity. Sets `isOverridden` to `true`. Overridden paths are preserved during cascade moves.

```bash
curl -X PUT "http://your-server/api/uns/entity/ENTITY_UUID" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "unsPath": "digilog/v1/custom/legacy/equipment/tp-42" }'
```

**Body:**
```json
{
  "unsPath": "digilog/v1/custom/legacy/equipment/tp-42"
}
```

**Response (200):**
```json
{
  "id": "mapping-uuid",
  "entityId": "entity-uuid",
  "unsPath": "digilog/v1/custom/legacy/equipment/tp-42",
  "isOverridden": true,
  "createdAt": "2026-03-01T08:00:00Z",
  "updatedAt": "2026-03-07T10:00:00Z"
}
```

**Role Required:** `SUPER_ADMIN`
**Reauth:** `OVERRIDE_UNS_PATH`
**Audit:** Logs `UNS_PATH_OVERRIDDEN` with before/after values

---

## Cascade Moves

When an entity is moved to a new parent, all descendant UNS paths are automatically updated. The process is two-step: first generate an impact preview, then confirm execution.

### POST /api/uns/entity/:entityId/move

Generate a move impact report showing which UNS paths would change.

```bash
curl -X POST "http://your-server/api/uns/entity/ENTITY_UUID/move" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "newParentId": "NEW_PARENT_UUID" }'
```

**Body:**
```json
{
  "newParentId": "new-parent-uuid"
}
```

Use `"newParentId": null` to move an entity to the root level.

**Response (200):**
```json
{
  "impact": [
    {
      "entityId": "entity-uuid",
      "entityName": "Temperature Probe TP-42",
      "currentPath": "digilog/v1/acme/mumbai/packaging/line-1/tp-42",
      "newPath": "digilog/v1/acme/delhi/warehouse/tp-42"
    }
  ],
  "summary": {
    "totalAffected": 5,
    "directChildren": 2,
    "descendants": 4
  }
}
```

**Role Required:** `SUPER_ADMIN` or `ADMIN`

---

### POST /api/uns/entity/:entityId/move/confirm

Confirm and execute the cascade move after reviewing the impact report. Updates all affected UNS paths atomically.

```bash
curl -X POST "http://your-server/api/uns/entity/ENTITY_UUID/move/confirm" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "newParentId": "NEW_PARENT_UUID" }'
```

**Response (200):**
```json
{
  "success": true,
  "updated": 5
}
```

**Role Required:** `SUPER_ADMIN` or `ADMIN`
**Reauth:** `UPDATE_UNS_CONFIG`
**Audit:** Logs `UNS_CONFIG_UPDATED` with new parent and update count

**Note:** Entities with `isOverridden: true` are preserved during cascade moves — their paths are not changed.

---

## Wildcard Search

### GET /api/uns/search

Search UNS mappings using MQTT-style wildcard patterns.

```bash
curl "http://your-server/api/uns/search?path=digilog/v1/acme/+/packaging/#" \
  -H "Authorization: Bearer USER_TOKEN"
```

| Wildcard | Meaning | Example |
|----------|---------|---------|
| `+` | Match one level | `digilog/v1/+/mumbai` matches any enterprise's Mumbai site |
| `#` | Match all remaining levels | `digilog/v1/acme/#` matches everything under Acme |

**Response (200):**
```json
[
  {
    "id": "mapping-uuid",
    "entityId": "entity-uuid",
    "unsPath": "digilog/v1/acme/mumbai/packaging/line-1/tp-42",
    "isOverridden": false,
    "entityName": "Temperature Probe TP-42"
  }
]
```

**Permission:** `ASSET_VIEW`

---

## Frontend UI

The UNS Configuration page is accessible at **Configuration → UNS Configuration** (`/config/uns`).

### Layout
- **Left panel (2/3 width):** Hierarchical UNS tree with ISA-95 level badges, expandable nodes, and wildcard search bar
- **Right panel (1/3 width):** Selected entity details — name, template, status, UNS path, timestamps, attributes preview
- **Path Override card (SUPER_ADMIN only):** Text input for custom path with Save Override and Reset buttons (reauth-protected)

---

## Next Steps

- [UNS User Guide](../user-guide/uns/uns.md) — UNS concepts and tree visualization
- [Entity API](entities.md) — Entity hierarchy management
- [Telemetry API](telemetry.md) — MQTT topic structure
