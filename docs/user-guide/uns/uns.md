# Unified Namespace (UNS)

The Unified Namespace is DigiLog's implementation of the ISA-95 compliant topic hierarchy for organizing and routing data across your industrial infrastructure. It provides a single, consistent namespace for all entity communication.

---

## What is the UNS?

The Unified Namespace maps your physical entity hierarchy to a standardized path structure. Each entity gets a unique path based on its position in the hierarchy, following the ISA-95 (IEC 62264) standard.

### Path Format

```
digilog/v1/<enterprise>/<site>/<area>/<line>/<cell>/<entity>
```

### Path Examples

| Entity | Hierarchy | UNS Path |
|--------|-----------|----------|
| Temperature Sensor | Acme > Mumbai > Packaging > Line 1 > Fill Station > TP-42 | `digilog/v1/acme/mumbai/packaging/line-1/fill-station/tp-42` |
| Pressure Gauge | Acme > Mumbai > Packaging > Line 1 > PG-18 | `digilog/v1/acme/mumbai/packaging/line-1/pg-18` |
| Cold Storage | Acme > Mumbai > Warehouse > CS-01 | `digilog/v1/acme/mumbai/warehouse/cs-01` |

### Path Sanitization

Entity names are sanitized for path usage:
- Converted to lowercase
- Spaces replaced with hyphens
- Special characters removed
- Multiple hyphens collapsed
- Leading/trailing hyphens stripped

---

## UNS Provisioning

### Automatic Provisioning

When an entity is created with data ingestion enabled, DigiLog automatically:

1. **Builds the UNS path** by walking up the entity hierarchy
2. **Creates a UNS mapping** record (`uns_mappings` table)
3. **Updates the entity's `unsPath`** field
4. **Generates allowed MQTT topics** based on the path

### Topic Structure

Each entity gets five MQTT topics:

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `<unsPath>/telemetry` | Device → Platform | Time-series data |
| `<unsPath>/attributes` | Device → Platform | Device properties |
| `<unsPath>/events` | Device → Platform | Device events |
| `<unsPath>/rpc/request` | Platform → Device | Remote commands |
| `<unsPath>/rpc/response` | Device → Platform | Command responses |

---

## UNS Tree

The UNS Tree provides a hierarchical visualization of the entire namespace.

### Viewing the Tree

Navigate to **Configuration** → **UNS Configuration** to see the full UNS tree.

The tree shows:
- ISA-95 level labels (Enterprise, Site, Area, Line, Cell, Entity)
- Entity names at each node
- Child counts for each branch
- Full UNS path for each node

### Tree Structure

```
digilog
└── v1
    └── acme-corp
        ├── mumbai-factory
        │   ├── packaging-hall
        │   │   ├── bottling-line-1
        │   │   │   ├── fill-station
        │   │   │   │   ├── fm-01 [Entity: Filling Machine]
        │   │   │   │   └── cm-02 [Entity: Capping Machine]
        │   │   │   └── label-station
        │   │   └── bottling-line-2
        │   └── warehouse
        │       └── cs-01 [Entity: Cold Storage]
        └── delhi-office
```

---

## Cascade Moves

When an entity's parent changes, the UNS paths for the entity and all its descendants are automatically updated.

### Move Impact Preview

Before moving an entity, DigiLog can generate an **impact report** showing:
- The entity's current path and new path
- All descendant entities and their path changes
- Number of affected entities

### Move Execution

The cascade move:
1. Updates the entity's `parentId`
2. Rebuilds UNS paths for the entity and all descendants
3. Updates `uns_mappings` and `asset_instances` tables
4. Preserves manually overridden paths (marked as `isOverridden`)

---

## Wildcard Search

Search the UNS using MQTT-style wildcard patterns:

| Wildcard | Meaning | Example |
|----------|---------|---------|
| `+` | Match one level | `digilog/v1/+/mumbai/+` matches any enterprise's Mumbai site areas |
| `#` | Match all remaining levels | `digilog/v1/acme/#` matches everything under Acme Corp |

### Search API

```bash
GET /api/uns/search?path=digilog/v1/acme/+/packaging/#
```

**Response:**
```json
[
  {
    "entityId": "abc-123",
    "unsPath": "digilog/v1/acme/mumbai/packaging/line-1/fm-01",
    "entityName": "Filling Machine FM-01"
  },
  {
    "entityId": "def-456",
    "unsPath": "digilog/v1/acme/mumbai/packaging/line-1/cm-02",
    "entityName": "Capping Machine CM-02"
  }
]
```

---

## Manual Overrides

UNS paths are normally computed from the entity hierarchy. However, SUPER_ADMIN users can manually set a custom path via the UNS Configuration page:

1. Select an entity in the UNS tree
2. In the Path Override card (right panel), enter the custom path
3. Click "Save Override" (requires re-authentication via `OVERRIDE_UNS_PATH`)
4. The `isOverridden` flag is set on the UNS mapping record
5. Cascade moves will skip entities with overridden paths
6. Click "Reset" to revert to the auto-generated path

This is useful for legacy equipment or non-standard naming conventions.

### Override API

```bash
PUT /api/uns/entity/:entityId
Body: { "unsPath": "digilog/v1/custom/legacy/equipment/tp-42" }
```

**Role Required:** SUPER_ADMIN | **Reauth:** OVERRIDE_UNS_PATH

---

## UNS Configuration UI

Navigate to **Configuration → UNS Configuration** (`/config/uns`):

- **Left panel (2/3 width):** Hierarchical tree with ISA-95 level badges (Enterprise, Site, Area, Line, Cell, Entity), expandable nodes, and a search bar supporting MQTT wildcards (`+` and `#`)
- **Right panel (1/3 width):** Selected entity details — name, template, status, UNS path (monospace), override indicator (violet highlight if overridden), timestamps, and attributes preview
- **Path Override card:** SUPER_ADMIN-only section with text input, Save Override button (reauth-protected), and Reset button

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/uns/tree` | SUPER_ADMIN/ADMIN/SUPERVISOR | Full UNS tree |
| GET | `/api/uns/entity/:entityId` | ASSET_VIEW | Get entity UNS mapping |
| PUT | `/api/uns/entity/:entityId` | SUPER_ADMIN + reauth | Override UNS path |
| POST | `/api/uns/entity/:entityId/move` | SUPER_ADMIN/ADMIN | Move impact preview |
| POST | `/api/uns/entity/:entityId/move/confirm` | SUPER_ADMIN/ADMIN + reauth | Execute cascade move |
| GET | `/api/uns/search?path=<pattern>` | ASSET_VIEW | Wildcard search |

---

## Next Steps

- [Entities & Hierarchy](../entities/entities-and-hierarchy.md) — Entity hierarchy management
- [MQTT Connectivity](../connectivity/mqtt.md) — MQTT broker and topics
- [Device Connectivity](../connectivity/device-connectivity.md) — Token management
