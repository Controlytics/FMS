# Phase E: Unified Namespace (UNS) (2-3 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07.
> UNS path builder, auto-provisioning, cascade move, wildcard matching, UNS config API (6 endpoints), and tree view data all operational.

## Prompt for Claude Code

```
You are implementing Phase E (UNS — Unified Namespace) of DigiLog's Data Ingestion & Integration Layer.

Phases A-D are complete. The full data pipeline works — messages arrive, flow through rule chains, and persist. Now you build the UNS layer that maps every entity to an ISA-95 hierarchical path and manages MQTT topic routing.

UNS gives every entity a deterministic MQTT topic path based on its position in the asset hierarchy: Enterprise/Site/Area/Line/Cell/Entity. When entities move in the hierarchy, their UNS paths must cascade-update.

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- UNS paths are ISA-95: Enterprise/Site/Area/Line/Cell/EntityName
- Every entity MUST have a UNS mapping — auto-created on entity creation
- Moving an entity in the hierarchy triggers cascade updates to ALL descendant UNS paths
- Before cascade: generate impact report showing all paths that will change
- User must confirm cascade after seeing impact report
- EMQX ACL (Phase B) already uses UNS paths — after cascade, device connections may need to re-auth
- UNS path builder must handle entities at any level (some levels may be empty/skipped)

WHAT TO BUILD:

1. UNS PATH BUILDER (apps/api/src/modules/uns/uns-path-builder.ts):
   - buildPath(entity): Walk up asset hierarchy → build ISA-95 path
   - Path format: digilog/v1/{Enterprise}/{Site}/{Area}/{Line}/{Cell}/{EntityName}
   - Handle gaps: if an entity is directly under a Site (no Area/Line/Cell), still build valid path
   - Sanitize names: lowercase, replace spaces with hyphens, strip special characters
   - Each entity gets publish and subscribe topic sets derived from base path

2. AUTO-PROVISIONING:
   - Hook into entity CRUD (existing module):
     On entity CREATE → build UNS path → INSERT UnsMapping → provision DeviceCredential if template has IoT enabled
   - On entity UPDATE (name change) → rebuild path → cascade if children exist
   - On entity DELETE → remove UnsMapping → revoke DeviceCredential

3. CASCADE MOVE (apps/api/src/modules/uns/uns.service.ts):
   - When entity moves in hierarchy (parent change):
     Step 1: Calculate new paths for entity + ALL descendants
     Step 2: Generate impact report: {entity, oldPath, newPath}[] for every affected entity
     Step 3: Return impact report to caller (UI shows before/after)
     Step 4: On user confirmation → update all UnsMapping rows in transaction
     Step 5: Publish MQTT notification to old and new paths (so devices know to reconnect)
   - Impact report includes count of affected entities, devices, and active connections

4. WILDCARD MATCHING (for MQTT subscriptions):
   - Support MQTT wildcards: + (single level) and # (multi-level)
   - Example: digilog/v1/AcmePharma/+/CleanRoom/# matches all clean rooms across all sites
   - Used by WebSocket subscriptions and admin monitoring

5. UNS CONFIG API (apps/api/src/modules/uns/routes.ts):
   GET    /api/uns/tree                — Full UNS tree (hierarchical view)
   GET    /api/uns/entity/:entityId    — Get entity's UNS mapping
   PUT    /api/uns/entity/:entityId    — Override UNS path (manual override, requires UNS_MANAGE)
   POST   /api/uns/entity/:entityId/move — Initiate move (returns impact report)
   POST   /api/uns/entity/:entityId/move/confirm — Confirm cascade after reviewing impact
   GET    /api/uns/search?path=pattern — Search by wildcard pattern

6. UNS TREE VIEW DATA:
   - Build hierarchical JSON from all UnsMapping rows
   - Each node: {name, level (enterprise/site/area/line/cell/entity), path, entityId?, childCount, deviceCount}
   - Support filtering by site, area, connectivity status

VERIFICATION:
- Create entity under Site1/Area1/Line1 → UnsMapping auto-created with correct path
- Move entity from Line1 to Line2 → impact report shows old/new paths → confirm → paths updated
- Entity with 50 descendants → cascade updates all 50 UnsMapping rows
- MQTT publish to digilog/v1/Acme/Site1/Area1/Line1/Entity1/telemetry → reaches entity
- Wildcard search digilog/v1/Acme/+/CleanRoom/# → returns matching entities
- Delete entity → UnsMapping removed, DeviceCredential revoked
```

## Relevant Spec Sections

- **Section 4.1**: UNS topic structure (ISA-95 levels, topic format)
- **Section 4.3**: UNS path builder (generation rules, sanitization)
- **Section 4.4**: Cascade move (impact report, confirmation flow)
- **Section 4.5**: Auto-provisioning (entity CRUD hooks)
- **Section 11.7**: UNS API endpoints
- **Section 12.2**: UnsMapping Prisma model


> **Update (2026-03-27):** Phase 2 Digital Filter Management System has been completed. See CHANGELOG.md for full details.

