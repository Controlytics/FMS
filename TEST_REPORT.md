# DigiLog Test Report

**Date:** 2026-02-19
**Tester:** Automated + Manual
**Environment:** EC2 (43.205.32.23), PostgreSQL 16, Node.js, PM2
**Build:** Turborepo (shared -> api -> web), all packages compiled successfully

---

## 1. API Endpoint Tests

### 1.1 Health & Auth
| Test | Endpoint | Method | Result |
|------|----------|--------|--------|
| Health check | `/api/health` | GET | PASS — `{"status":"ok"}` |
| Login | `/api/auth/login` | POST | PASS — Returns JWT token |

### 1.2 Asset Templates
| Test | Endpoint | Method | Result |
|------|----------|--------|--------|
| List templates | `/api/assets/templates` | GET | PASS — Returns 9 templates |
| Create with telemetry | `/api/assets/templates` | POST | PASS — telemetrySchema saved (2 points) |
| Get detail | `/api/assets/templates/:id` | GET | PASS — Returns full template |
| Update telemetry | `/api/assets/templates/:id` | PUT | PASS — Version bumped to 2, telemetry updated to 3 points |
| Template versions | `/api/assets/templates/:id/versions` | GET | PASS — Returns version history |
| Delete template | `/api/assets/templates/:id` | DELETE | PASS |

### 1.3 Asset Instances
| Test | Endpoint | Method | Result |
|------|----------|--------|--------|
| Create with telemetryConfig | `/api/assets/instances` | POST | PASS — Instance created with telemetry config |
| Get detail (incl template telemetry) | `/api/assets/instances/:id` | GET | PASS — Template includes telemetrySchema (2 points), instance has telemetryConfig |
| Tree view | `/api/assets/instances/tree` | GET | PASS — Returns 8 tree nodes |
| Delete instance | `/api/assets/instances/:id` | DELETE | PASS |

### 1.4 Relationships
| Test | Endpoint | Method | Result |
|------|----------|--------|--------|
| Create relationship | `/api/assets/relationships` | POST | PASS — Bidirectional created |
| List relationships | `/api/assets/relationships` | GET | PASS — Returns array |

---

## 2. Build Verification

| Package | Status | Notes |
|---------|--------|-------|
| `@digilog/shared` | PASS | TypeScript compiled, `TELEMETRY_DATA_TYPES` exported |
| `@digilog/api` | PASS | TypeScript compiled, clean dist |
| `@digilog/web` | PASS | TypeScript + Vite build (811KB main bundle) |

---

## 3. Database Verification

| Check | Status | Notes |
|-------|--------|-------|
| `asset_templates.telemetry_schema` column | EXISTS | JSONB, default `[]` |
| `asset_instances.telemetry_config` column | EXISTS | JSONB, default `{}` |
| Prisma schema in sync | PASS | `prisma db push` successful |
| Seed data | PASS | 6 default roles with permissions |

---

## 4. Frontend Features Tested

### 4.1 Asset Template Editor (`/assets/templates`)
| Feature | Status | Notes |
|---------|--------|-------|
| Section 1: Basic Info | PASS | Name, description, icon selector |
| Section 2: Attribute Schema | PASS | 9 data types, numeric constraints |
| Section 3: Telemetry Schema | PASS | Add/remove points, 5 data types (INTEGER, FLOAT, BOOLEAN, STRING, ENUM), unit, description |
| Section 4: Expected Identifiers | PASS | 5 identifier types |
| Section 5: Alarm Rules | PASS | 7 rule types, 3 severities |
| Create template with telemetry | PASS | Saved to DB and returned in response |
| Edit template telemetry | PASS | Loads existing, saves updates, bumps version |

### 4.2 Asset Explorer (`/assets`)
| Feature | Status | Notes |
|---------|--------|-------|
| Tree view | PASS | Hierarchical display with expand/collapse |
| List view | PASS | Paginated with search and template filter |
| Overview tab | PASS | Basic asset info |
| Attributes tab | PASS | Shows template attributes with values |
| Telemetry tab | PASS | Shows template telemetry schema + instance config values |
| Relationships tab | PASS | Shows bidirectional relationships with visual graph map |
| Hierarchical tree diagram | PASS | Visual node boxes with SVG arrow connectors, top-to-bottom flow, relationship labels, click-to-navigate |
| Identifiers tab | PASS | Shows attached identifiers |
| Audit History tab | PASS | Shows audit records for asset |

### 4.3 Link Assets Dialog
| Feature | Status | Notes |
|---------|--------|-------|
| Source Asset dropdown | PASS | Fixed — API now returns `null` for root parentId; frontend handles null/empty/undefined |
| Target Assets multi-select | PASS | Checkbox list with search, chips — populates correctly from flatAssetList |
| Relationship type selector | PASS | 7 forward types |
| Direction preview | PASS | Shows all source->target pairs |
| Bulk relationship creation | PASS (API) | Creates relationships sequentially |
| Tree auto-expand after link | PASS | Expands source node |
| Auto-switch to Relationships tab | PASS | After linking, selects source and shows relationships graph |
| Dialog scroll/overflow | PASS | Dialog stays within 90vh, chips and preview scroll independently |

---

## 5. Changes Made This Session

### Files Modified (14)
1. `packages/shared/src/schemas/assets.ts` — Added `TELEMETRY_DATA_TYPES`, `telemetryDefinitionSchema`, `telemetrySchema` in template schema
2. `packages/shared/src/index.ts` — Exported `TELEMETRY_DATA_TYPES`
3. `apps/api/src/modules/assets/routes.ts` — Added telemetrySchema to template create/update, telemetrySchema to instance detail template select; Fixed tree endpoint `parentId` to be nullable
4. `apps/web/src/routes/assets/templates.tsx` — Added TelemetryDef type, TELEMETRY_DATA_TYPES, emptyTelemetry(), add/update/remove helpers, buildBody mapping, openEditDialog loading, Telemetry Schema collapsible section
5. `apps/web/src/routes/assets/index.tsx` — Added TelemetryDefinition interface, Telemetry tab, multi-select Link Assets dialog with search/chips/bulk create; Fixed `flatAssetList` and `rootNodes` to handle null/empty parentId
6. `apps/web/src/hooks/use-field-labels.ts` — Restored telemetry labels
7. `apps/api/prisma/schema.prisma` — Restored telemetrySchema and telemetryConfig columns

### Files Deleted (Previous Session Cleanup)
- `packages/shared/src/schemas/instruments.ts`
- `apps/api/src/modules/instruments/` (entire directory)
- `apps/web/src/routes/instruments/` (entire directory)

---

## 6. Open Items

| Item | Priority | Description |
|------|----------|-------------|
| — | — | No open items — all reported issues resolved |
