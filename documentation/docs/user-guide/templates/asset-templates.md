# Asset Templates

An Asset Template defines the blueprint for a category of entities. Templates specify what attributes an entity has, what telemetry it produces, how it connects to the platform, and where it fits in the ISA-95 hierarchy.

---

## Template Properties

### Basic Information

| Field | Required | Description |
|-------|----------|-------------|
| **Name** | Yes | Unique template name (e.g., "Temperature Sensor", "Production Line") |
| **Category** | Yes | ISA-95 level: Enterprise, Site, Area, Line, Cell, Equipment, Sensor, Custom |
| **Description** | No | Human-readable description of the template's purpose |
| **Version** | Auto | Auto-incremented on each update |

### Connection Limits

| Field | Default | Description |
|-------|---------|-------------|
| **Max Connections** | 10 | Maximum number of child entities this type can contain |
| **Max Parent Connections** | 1 | Set to 0 to prevent this entity type from having a parent |

> **Note:** Setting Max Parent Connections to 0 creates a "root-only" entity type that cannot be placed under any parent in the hierarchy.

---

## Attribute Schema

The attribute schema defines typed fields that every entity created from this template will have. This provides structured, validated data for each entity.

### Supported Attribute Types

| Type | Description | Example |
|------|-------------|---------|
| **TEXT** | Free-form string | Serial number, location, notes |
| **NUMBER** | Numeric value (integer or decimal) | Threshold, capacity, max RPM |
| **BOOLEAN** | True/false toggle | Is calibrated, requires maintenance |
| **ENUM** | Selection from predefined options | Status: [Active, Standby, Maintenance] |
| **DATE** | Date/datetime value | Installation date, last calibration |
| **JSON** | Arbitrary JSON object | Configuration blob, metadata |

### Attribute Properties

Each attribute in the schema has:

| Property | Description |
|----------|-------------|
| **Key** | Machine-readable identifier (e.g., `serial_number`) |
| **Label** | Human-readable display name (e.g., "Serial Number") |
| **Type** | One of the supported types above |
| **Required** | Whether the field must be filled when creating an entity |
| **Default Value** | Pre-filled value for new entities |
| **Options** | For ENUM type: the list of allowed values |

### Example Schema

```json
[
  {
    "key": "serial_number",
    "label": "Serial Number",
    "type": "TEXT",
    "required": true
  },
  {
    "key": "max_temperature",
    "label": "Max Temperature (C)",
    "type": "NUMBER",
    "required": false,
    "defaultValue": 100
  },
  {
    "key": "status",
    "label": "Operational Status",
    "type": "ENUM",
    "required": true,
    "options": ["Active", "Standby", "Maintenance", "Decommissioned"]
  }
]
```

---

## Telemetry Configuration

### Telemetry Keys

Define the telemetry keys that entities of this type will report:

| Field | Description |
|-------|-------------|
| **Key** | Telemetry key name (e.g., `temperature`, `pressure`, `vibration`) |
| **Unit** | Display unit (e.g., "°C", "PSI", "mm/s") |
| **Description** | What this measurement represents |

### Data Ingestion Settings

| Field | Description |
|-------|-------------|
| **Data Ingestion Enabled** | Whether entities can receive telemetry data |
| **Transport Protocol** | HTTP, MQTT, or WebSocket |
| **Credential Type** | Access Token (all protocols) or X.509 Certificate (MQTT only) |

When data ingestion is enabled, creating an entity automatically:
1. Generates a device access token
2. Creates a connectivity status record
3. Provisions a UNS mapping with MQTT topics
4. Sets up allowed topics based on the entity's UNS path

---

## Template Versioning

Templates use integer versioning. Each time you save changes to a template:
- The version number increments automatically
- Existing entities retain their creation-time version
- New entities are created with the latest version

> **Note:** Changing a template's attribute schema does not retroactively modify existing entities. Existing entities keep their current attribute values.

---

## Template Management

### Creating a Template

1. Navigate to **Entity Explorer** → **Templates** tab.
2. Click **Create Template**.
3. Fill in the basic information and category.
4. Define the attribute schema.
5. Configure telemetry keys and data ingestion.
6. Click **Save**.

### Editing a Template

1. Click on a template in the list.
2. Modify any fields.
3. Click **Save** — the version auto-increments.

### Deleting a Template

1. Click the delete icon on the template.
2. Confirm deletion.

> **Warning:** You cannot delete a template that has active entities. Deactivate or delete all entities first.

### Required Permissions

| Action | Permission |
|--------|-----------|
| View templates | `ASSET_VIEW` |
| Create template | `ASSET_CREATE` |
| Edit template | `ASSET_UPDATE` |
| Delete template | `ASSET_DELETE` |

---

## Next Steps

- [Entities & Hierarchy](../entities/entities-and-hierarchy.md) — Create entities from templates
- [Device Connectivity](../connectivity/device-connectivity.md) — Connect devices using auto-generated tokens
- [Telemetry](../telemetry/telemetry.md) — Send and query telemetry data
