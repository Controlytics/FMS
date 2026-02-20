# DigiLog Shared — Types & Schemas

## Purpose
Shared Zod schemas and TypeScript types used by both API and Web apps. Single source of truth for validation rules and type definitions.

## Structure
- `src/types/roles.ts` — Role enum, hierarchy, creatable roles map
- `src/types/permissions.ts` — Permission constants (PERMISSIONS), role-permission matrix. Includes 7 ASSET_* permissions: ASSET_TEMPLATE_MANAGE, ASSET_CREATE, ASSET_UPDATE, ASSET_DELETE, ASSET_RELATIONSHIP_MANAGE, ASSET_IDENTIFIER_MANAGE, ASSET_VIEW
- `src/types/permission-categories.ts` — PERMISSION_CATEGORIES for role create/edit dialog. Categories: User Management, Configuration, Audit & Approvals, Entity Management
- `src/types/feature-privileges.ts` — FEATURE_PRIVILEGES and FEATURE_PRIVILEGE_CATEGORIES for role-privileges config page. Includes entity privileges: assets.view, assets.create, assets.edit, assets.delete, assets.templates, assets.relationships, assets.identifiers
- `src/types/sidebar-items.ts` — SIDEBAR_ITEMS for sidebar config page. Items: dashboard, users, entities (assets), entity-templates (asset-templates), configuration, notifications, audit
- `src/types/audit-actions.ts` — Audit action enum. Includes 12 asset actions: ASSET_TEMPLATE_CREATED/UPDATED/DELETED, ASSET_TEMPLATE_VERSION_CREATED, ASSET_CREATED/UPDATED/STATUS_CHANGED/DELETED, ASSET_RELATIONSHIP_CREATED/DELETED, ASSET_IDENTIFIER_CREATED/DELETED
- `src/types/reauth-actions.ts` — REAUTH_ACTIONS, REAUTH_ACTION_CATEGORIES for action-reauth config. Categories: User Management, Configuration, Role Management, Backup, Entity Management. Entity reauth actions: CREATE/UPDATE/DELETE_ASSET_TEMPLATE, CREATE/UPDATE/DELETE_ASSET, CREATE/DELETE_ASSET_RELATIONSHIP, CREATE/DELETE_ASSET_IDENTIFIER
- `src/types/audit-templates.ts` — AUDIT_TEMPLATE_DEFAULTS, AUDIT_TEMPLATE_CATEGORIES, getDefaultTemplates(). Categories: User Management, Authentication, Configuration, Role Management, Backup, Data & Approvals, Entity Management. Each template has label, category, template string with placeholders, and placeholders array
- `src/schemas/assets.ts` — Zod schemas and constants for asset operations:
  - Constants: ATTRIBUTE_DATA_TYPES (9: TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE), TELEMETRY_DATA_TYPES (5: INTEGER, FLOAT, BOOLEAN, STRING, ENUM), RELATIONSHIP_TYPES (12: CONTAINS, CONTAINED_IN, CONNECTED_TO, FEEDS, FED_BY, DEPENDS_ON, DEPENDED_ON_BY, BACKS_UP, BACKED_UP_BY, MONITORS, MONITORED_BY, CUSTOM), IDENTIFIER_TYPES (5: QR, BARCODE, RFID, NFC, MANUAL), ASSET_STATUSES (5: Active, Inactive, Under Maintenance, Commissioning, Decommissioned), INVERSE_RELATIONSHIP_MAP, ALARM_RULE_TYPES (7: HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM), ALARM_SEVERITIES (3: WARNING, ALARM, CRITICAL)
  - Schemas: createAssetTemplateSchema (includes category, attributeSchema with numericConstraints, telemetrySchema, expectedIdentifiers, expectedRelationships, statusLifecycle, alarmRules, maxParentConnections, maxConnections), updateAssetTemplateSchema (partial), createAssetInstanceSchema, updateAssetInstanceSchema, createAssetRelationshipSchema, createAssetIdentifierSchema, assetQuerySchema, templateQuerySchema
  - Attribute numericConstraints: enabled (bool), min, max, resolution (positive number)
- `src/schemas/` — Other Zod schemas for auth, users, config, audit, action-reauth
- `src/index.ts` — Re-exports everything

## Dynamic Configuration Pattern
All configuration page data definitions are centralized here:
- **Adding a permission**: Add to `PERMISSIONS` in permissions.ts, then add to `PERMISSION_CATEGORIES` in permission-categories.ts
- **Adding a feature privilege**: Add to `FEATURE_PRIVILEGES` in feature-privileges.ts
- **Adding a sidebar item**: Add to `SIDEBAR_ITEMS` in sidebar-items.ts
- **Adding a reauth action**: Add to `REAUTH_ACTIONS` in reauth-actions.ts
- **Adding an audit template**: Add to `AUDIT_TEMPLATE_DEFAULTS` in audit-templates.ts
- **Adding an entity schema**: Add to `src/schemas/assets.ts` and export from `src/index.ts`

All config pages import from this package — no hardcoded lists in frontend components.

## Usage
Import from `@digilog/shared` in either app:
```ts
import { PERMISSIONS, PERMISSION_CATEGORIES, FEATURE_PRIVILEGES, SIDEBAR_ITEMS } from '@digilog/shared';
import { createAssetTemplateSchema, ATTRIBUTE_DATA_TYPES, INVERSE_RELATIONSHIP_MAP, ALARM_RULE_TYPES, ALARM_SEVERITIES } from '@digilog/shared';
import { REAUTH_ACTIONS, REAUTH_ACTION_CATEGORIES, AUDIT_TEMPLATE_DEFAULTS, AUDIT_TEMPLATE_CATEGORIES } from '@digilog/shared';
```
