# Entities & Hierarchy

Entities represent physical equipment in a hierarchical tree following ISA-95.

## Entity Templates
Templates define the blueprint: attribute schema, alarm rules, checklist fields, connectivity settings, and relationship constraints.

## Entity Instances
Instances are created from templates with: unique name, UNS path, status (Active/Inactive/Under Maintenance/Decommissioned/Quarantine), attributes, telemetry, and relationships.

## Hierarchy
Parent-child relationships form a tree: Enterprise > Site > Area > Line > Equipment > Sensor. Each entity has a UNS path auto-generated from its position.

## Relationships (12 types)
CONTAINS/CONTAINED_IN, FEEDS/FED_BY, DEPENDS_ON/DEPENDED_ON_BY, MONITORS/MONITORED_BY, BACKS_UP/BACKED_UP_BY, CONNECTED_TO, CUSTOM.

## Identifiers
QR Code, RFID, NFC, Barcode, Manual — for physical equipment tagging and mobile checklist scanning.


### Filter-Specific Entity Fields
Asset instances can be designated as filters with additional fields:
- `filter_profile_id` — Links to a filter profile (which links to a cleaning profile)
- `current_lifecycle_state` — Current cleaning stage (WASH_IN, DRY_OUT, etc.)
- `current_cycle_id` — Active cleaning cycle reference
- `filter_set` — SET_A or SET_B for dual-set AHU management



---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
