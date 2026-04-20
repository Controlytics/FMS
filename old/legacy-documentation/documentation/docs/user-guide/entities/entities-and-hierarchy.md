# Entities & Hierarchy

Entities represent physical equipment in a hierarchical tree following the ISA-95 standard.

## Entity Templates
Templates define the blueprint for entity types:
- **Attribute Schema** -- 9 data types (TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE)
- **Telemetry Schema** -- Expected data points with 5 types (INTEGER, FLOAT, BOOLEAN, STRING, ENUM), units, and descriptions
- **Alarm Rules** -- 7 rule types (HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM) with 3 severities
- **Checklist Schema** -- 14 question types for inspection forms
- **Connectivity Settings** -- Transport protocol, credential type, auto-provision, rate limits
- **Relationship Constraints** -- Max connections, max parent connections
- **Template Categories** -- General, Equipment, Room, Building, Sensor, Vehicle, Utility, Process, Storage, Laboratory
- **Versioning** -- Every edit creates a new version; instances track which version they were created from

## Entity Instances
Instances are created from templates with:
- Unique name and UNS path (auto-generated from hierarchy position)
- Status: Active, Inactive, Under Maintenance, Commissioning, Decommissioned
- Attributes, telemetry configuration, and checklist data
- Relationships to other entities
- Physical identifiers (QR, RFID, NFC, Barcode, Manual)

## Hierarchy
Parent-child relationships form a tree: Enterprise > Site > Area > Line > Equipment > Sensor. Each entity has a UNS path auto-generated from its position in the tree.

## Relationships (12 types)
| Forward | Inverse |
|---------|---------|
| CONTAINS | CONTAINED_IN |
| FEEDS | FED_BY |
| DEPENDS_ON | DEPENDED_ON_BY |
| MONITORS | MONITORED_BY |
| BACKS_UP | BACKED_UP_BY |
| CONNECTED_TO | CONNECTED_TO (symmetric) |
| CUSTOM | CUSTOM |

All relationships are bidirectional with auto-inverse creation. CONTAINS relationships enforce cycle detection to prevent circular hierarchies.

## Identifiers
QR Code, RFID, NFC, Barcode, Manual -- for physical equipment tagging and mobile checklist scanning.

---

## Filter-Specific Entity Fields (Phase 2)

Asset instances can be designated as filters with additional fields managed by the Digital Filter Management System:

| Field | Description |
|-------|-------------|
| `filter_profile_id` | Links to a filter profile (which links to a cleaning profile) |
| `current_lifecycle_state` | Current cleaning stage (e.g., WASH_IN, DRY_OUT, READY_FOR_USE) |
| `current_cycle_id` | Active cleaning cycle reference |
| `filter_set` | SET_A or SET_B for dual-set AHU management |
| `equipment_group_id` | AHU group for dashboard views |

Filter entities participate in cleaning cycles, PM schedules, and the full filter lifecycle including retirement and replacement.
