# Unified Namespace (UNS)

ISA-95 hierarchical topic structure for organizing entities and MQTT communication.

## Levels
Enterprise > Site > Area > Line > Equipment > Sensor

## Paths
Auto-generated from entity hierarchy position. Example: `MyPlant/Area1/Line1/Sensor01`

When an entity is moved in the hierarchy, its UNS path is automatically updated (cascade move).

## Wildcards (MQTT)
| Wildcard | Description | Example |
|----------|-------------|---------|
| `+` | Single level | `Plant/+/Line1/#` |
| `#` | Multi level (must be last) | `Plant/Area1/#` |

## Browse
Navigate to **Config > UNS** to view the full namespace tree with entity mapping.

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/uns/tree` | Get full UNS tree |
| GET | `/api/uns/entity/:id` | Get UNS path for entity |
| POST | `/api/uns/move` | Move entity in UNS tree |
| GET | `/api/uns/search` | Search UNS paths with wildcards |

## MQTT Integration
UNS paths are used as MQTT topic prefixes:
- `digilog/v1/<uns-path>/telemetry` -- Telemetry data
- `digilog/v1/<uns-path>/attributes` -- Device attributes
- `digilog/v1/<uns-path>/events` -- Device events

## Phase 2: Filter UNS Paths
Filter entities in the Digital Filter Management System follow the same UNS hierarchy. AHU equipment groups can map to Area or Line level nodes, with individual filters as Equipment-level entities beneath them.
