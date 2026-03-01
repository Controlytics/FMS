# Entities & Hierarchy

Entities are the core building blocks of DigiLog. An entity represents any physical or logical asset in your system — a factory, production line, machine, sensor, or any item you need to monitor and manage.

---

## Entity Concepts

### What is an Entity?

An entity is an instance of an **Asset Template**. It has:

- **Name** — A unique human-readable identifier
- **Template** — The blueprint defining its category, attributes, and capabilities
- **Status** — Current operational state (Active, Maintenance, Inactive, etc.)
- **Attributes** — Typed key-value properties defined by the template schema
- **Telemetry** — Time-series data collected from connected devices
- **Parent** — Optional parent entity for hierarchical organization
- **Children** — Entities that belong to this entity

### Entity Lifecycle

```
Created → Active → Maintenance → Inactive → Deleted (soft)
```

Entities are soft-deleted — they are marked as inactive rather than permanently removed. This preserves audit trail integrity and allows data recovery.

---

## ISA-95 Hierarchy

DigiLog organizes entities in a hierarchy following the **ISA-95** (IEC 62264) standard for industrial automation. This provides a standardized way to model your physical plant structure.

### Hierarchy Levels

| Level | ISA-95 Role | Example |
|-------|------------|---------|
| **Enterprise** | Top-level organization | Acme Corp |
| **Site** | Physical location | Mumbai Factory |
| **Area** | Functional area within a site | Packaging Hall |
| **Line** | Production or process line | Bottling Line 1 |
| **Cell** | Work cell or station | Fill Station |
| **Equipment** | Individual machine | Filling Machine FM-01 |
| **Sensor** | Measurement device | Temperature Probe TP-42 |

### Example Hierarchy

```
Acme Corp (Enterprise)
├── Mumbai Factory (Site)
│   ├── Packaging Hall (Area)
│   │   ├── Bottling Line 1 (Line)
│   │   │   ├── Fill Station (Cell)
│   │   │   │   ├── Filling Machine FM-01 (Equipment)
│   │   │   │   │   ├── Temperature Probe TP-42 (Sensor)
│   │   │   │   │   └── Pressure Gauge PG-18 (Sensor)
│   │   │   │   └── Capping Machine CM-02 (Equipment)
│   │   │   └── Label Station (Cell)
│   │   └── Bottling Line 2 (Line)
│   └── Warehouse (Area)
│       └── Cold Storage Unit CS-01 (Equipment)
└── Delhi Office (Site)
```

### Parent-Child Rules

- An entity can have **at most one parent** (configurable via `maxParentConnections` on the template).
- An entity can have **multiple children** (limited by `maxConnections` on its template).
- An entity that already has children **cannot be reassigned** as a child of another entity (prevents hierarchy conflicts).
- **Cycle detection** prevents circular relationships (A → B → C → A).

---

## Entity Explorer

The Entity Explorer is the main interface for managing entities. Access it from the **Entity Explorer** item in the left sidebar.

### Tree View

The left panel shows all entities in a hierarchical tree. Click any entity to expand its children. The tree reflects the ISA-95 parent-child relationships.

### Entity Detail Panel

Clicking an entity opens the detail panel on the right with these tabs:

| Tab | Description |
|-----|-------------|
| **Details** | Name, template, status, description, custom attributes |
| **Attributes** | Template-defined typed attributes (text, number, boolean, enum, date, JSON) |
| **Telemetry** | Real-time and historical time-series data charts |
| **Connectivity** | Device access token, connection status, code snippets |
| **Checklists** | Inspection forms and submission history |
| **QR Code** | Generated QR code linking to the entity's checklist form |

### Entity Actions

| Action | Permission Required | Description |
|--------|-------------------|-------------|
| Create Entity | `ASSET_CREATE` | Create a new entity from a template |
| Edit Entity | `ASSET_UPDATE` | Modify name, status, attributes |
| Delete Entity | `ASSET_DELETE` | Soft-delete entity and all descendants |
| Change Status | `ASSET_UPDATE` | Update operational status |
| View Entity | `ASSET_VIEW` | View entity details and data |

> **Important:** Deleting an entity also soft-deletes all descendant entities and cleans up associated device credentials, connectivity status, UNS mappings, QR codes, latest telemetry, and data streams.

---

## Relationships

DigiLog maintains two types of relationships between entities:

### CONTAINS / CONTAINED_IN

When entity A is the parent of entity B:
- A **CONTAINS** B (A is the parent)
- B is **CONTAINED_IN** A (B is the child)

These relationship pairs are automatically created when you set a parent during entity creation or editing, and automatically cleaned up on delete.

### Relationship Management

Relationships are managed through the entity's parent field:
1. Set a parent during entity creation.
2. Change the parent by editing the entity.
3. Remove the parent by setting it to "None".

When the parent changes, DigiLog automatically:
- Removes old CONTAINS/CONTAINED_IN pairs
- Creates new relationship pairs
- Updates the UNS path for the entity and all descendants
- Logs the change in the audit trail

---

## Unified Namespace (UNS) Path

Each entity is assigned a **UNS path** based on its position in the hierarchy. The path follows the pattern:

```
digilog/v1/<enterprise>/<site>/<area>/<line>/<cell>/<entity>
```

Example: `digilog/v1/acme-corp/mumbai-factory/packaging-hall/bottling-line-1/fill-station/fm-01`

The UNS path is used for:
- **MQTT topic routing** — devices publish to their entity's UNS topic
- **Data organization** — telemetry is associated via the entity's path
- **Search and filtering** — wildcard queries across the namespace

See [Unified Namespace](../uns/uns.md) for details.

---

## Next Steps

- [Asset Templates](../templates/asset-templates.md) — Define entity blueprints
- [Telemetry](../telemetry/telemetry.md) — Collect and query time-series data
- [Device Connectivity](../connectivity/device-connectivity.md) — Connect devices to entities
