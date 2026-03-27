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
Templates with alarm rules auto-generate a default rule chain that evaluates incoming telemetry against thresholds.


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
