# UNS API

The Unified Namespace (UNS) API provides endpoints for viewing the namespace tree, managing entity UNS paths, performing cascade moves, and searching by wildcard patterns.

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
GET /api/uns/entity/ENTITY_UUID
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

Manually override the UNS path for an entity.

```bash
curl -X PUT "http://your-server/api/uns/entity/ENTITY_UUID" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "unsPath": "digilog/v1/custom/legacy/equipment/tp-42" }'
```

Sets `isOverridden` to `true`. Overridden paths are preserved during cascade moves.

**Role Required:** `SUPER_ADMIN`

---

## Cascade Moves

When an entity is moved to a new parent, all descendant UNS paths must be updated. The move process is a two-step operation: preview impact, then confirm.

### POST /api/uns/entity/:entityId/move

Generate a move impact report showing which paths will change.

```bash
curl -X POST "http://your-server/api/uns/entity/ENTITY_UUID/move" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "newParentId": "NEW_PARENT_UUID" }'
```

Use `"newParentId": null` to move to root level.

**Response (200):**
```json
{
  "impact": [
    {
      "entityId": "entity-uuid",
      "entityName": "Line 1",
      "currentPath": "digilog/v1/acme/mumbai/packaging/line-1",
      "newPath": "digilog/v1/acme/delhi/production/line-1"
    },
    {
      "entityId": "child-uuid",
      "entityName": "TP-42",
      "currentPath": "digilog/v1/acme/mumbai/packaging/line-1/tp-42",
      "newPath": "digilog/v1/acme/delhi/production/line-1/tp-42"
    }
  ],
  "summary": {
    "totalAffected": 5,
    "directChildren": 3,
    "descendants": 4
  }
}
```

### POST /api/uns/entity/:entityId/move/confirm

Execute the cascade move after reviewing the impact report.

```bash
curl -X POST "http://your-server/api/uns/entity/ENTITY_UUID/move/confirm" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "newParentId": "NEW_PARENT_UUID" }'
```

**Response (200):**
```json
{ "success": true, "updated": 5 }
```

**Role Required:** `SUPER_ADMIN` or `ADMIN`

---

## Wildcard Search

### GET /api/uns/search

Search UNS mappings using MQTT-style wildcard patterns.

```bash
GET /api/uns/search?path=digilog/v1/acme/+/packaging/#
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

## Next Steps

- [UNS User Guide](../user-guide/uns/uns.md) — UNS concepts and tree visualization
- [Entity API](entities.md) — Entity hierarchy management
- [Telemetry API](telemetry.md) — MQTT topic structure
