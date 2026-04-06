# Asset Templates

Templates define reusable blueprints for entity types.

## Fields
- Name, Category, Description, Icon
- Attribute Schema (14 data types: INTEGER, FLOAT, BOOLEAN, TEXT, FILE, URL, DATE, DATETIME, DROPDOWN, etc.)
- Telemetry Schema (expected data points with types and units)
- Alarm Rules (threshold, rate-of-change, absence)
- Checklist Schema (14 question types)
- Connectivity Settings (transport type, credential type, auto-provision, rate limits)
- Relationship Constraints (max connections, max parents)

## Versioning
Every edit creates a new version. Instances track which version they were created from.

## Default Rule Chain
Templates with alarm rules auto-generate a default rule chain that evaluates incoming telemetry against thresholds. 77 node types available across 8 categories.

## Phase 2: Filter Templates
Templates can be used for filter entities. When an entity created from a template is assigned a filter profile, it gains filter-specific fields (filter_profile_id, current_lifecycle_state, current_cycle_id, filter_set) and can participate in the cleaning pipeline workflow.
