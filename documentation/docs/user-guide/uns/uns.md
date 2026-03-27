# Unified Namespace (UNS)

ISA-95 hierarchical topic structure.

## Levels
Enterprise > Site > Area > Line > Equipment > Sensor

## Paths
Auto-generated from entity hierarchy. Example: MyPlant/Area1/Line1/Sensor01

## Wildcards (MQTT)
- + (single level): Plant/+/Line1/#
- # (multi level, must be last): Plant/Area1/#

## Browse
Config > UNS to view the full namespace tree.


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
