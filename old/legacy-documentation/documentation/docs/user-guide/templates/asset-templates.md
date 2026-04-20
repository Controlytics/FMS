# Asset Templates

Templates define reusable blueprints for entity types in the DigiLog hierarchy.

## Template Fields
- **Basic Info:** Name, Category (10 categories), Description, Icon
- **Attribute Schema:** 9 data types (INTEGER, FLOAT, BOOLEAN, TEXT, FILE, URL, DATE, DATETIME, DROPDOWN) with numeric constraints (min, max, resolution)
- **Telemetry Schema:** Expected data points with 5 types (INTEGER, FLOAT, BOOLEAN, STRING, ENUM), unit, and description
- **Alarm Rules:** 7 rule types (HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM) with 3 severities (WARNING, ALARM, CRITICAL)
- **Checklist Schema:** 14 question types for digital inspection forms
- **Connectivity Settings:** Transport type (HTTP/MQTT), credential type, auto-provision, rate limits
- **Relationship Constraints:** Max connections, max parent connections

## Template Categories
General, Equipment, Room, Building, Sensor, Vehicle, Utility, Process, Storage, Laboratory

## Versioning
Every edit creates a new version. Instances track which version they were created from. Version history is accessible via the API.

## Default Rule Chain
Templates with alarm rules auto-generate a default rule chain that evaluates incoming telemetry against configured thresholds, creating and clearing alarms automatically.

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assets/templates` | List templates with pagination |
| GET | `/api/assets/templates/:id` | Get template detail |
| POST | `/api/assets/templates` | Create template |
| PUT | `/api/assets/templates/:id` | Update template (creates new version) |
| DELETE | `/api/assets/templates/:id` | Delete template |
| GET | `/api/assets/templates/:id/versions` | Get version history |

## Phase 2: Filter Templates
Filter entities are regular asset instances created from templates. The template defines the base entity structure, while the filter profile (assigned separately) links the entity to a cleaning profile for lifecycle management. Templates for filter-type entities typically include telemetry schemas for differential pressure readings and attributes for filter specifications (size, material, HEPA class).
