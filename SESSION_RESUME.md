# DigiLog — Session Resume Point

**Last Updated:** 2026-02-20
**Branch:** `feature/user-id-config`
**Status:** Phase 2 features implemented — connection limits, toast notifications, comprehensive Asset→Entity rename (UI + DB + API), template view dialog with neutral badge styling. Critical/high bug fixes applied (reauth, await, missing fields, parentId null). Ready for next phase.

---

## What Was Completed (Phase 2 — 2026-02-20)

### Connection Limit Enforcement

| Feature | Status |
|---------|--------|
| `maxConnections` field on entity templates (DB + Zod + API) | Done |
| Total connection limit enforced on POST /relationships (both entities) | Done |
| Total connection limit enforced on POST /instances with parentId | Done |
| `connectionInfo` in success/error responses | Done |
| "Connections Allowed" / "Connections Used" cards in Overview tab | Done |
| "Parent Connections Allowed" / "Parent Connections Used" cards in Overview tab | Done |
| Progress bars with green/red color coding | Done |

### Toast Notification System

| Feature | Status |
|---------|--------|
| Toast component (4 variants, auto-dismiss, slide-in animation) | Done |
| ToastProvider + useToast hook (React Context) | Done |
| Toast on relationship create/delete/attach/remove | Done |

### Global Rename: Asset → Entity

| Feature | Status |
|---------|--------|
| Sidebar labels: "Entities", "Entity Templates" | Done |
| Frontend page titles: "Entity Explorer", "Entity Templates" | Done |
| API Swagger tags: "Entity Templates", "Entities", "Entity Relationships", "Entity Identifiers" | Done |
| All frontend dialogs, buttons, placeholders, tooltips, error messages, empty states | Done |
| API summaries, descriptions, error messages, connectionInfo keys | Done |
| Shared package types (permissions, privileges, reauth, audit, sidebar) | Done |
| Role privileges, action reauth, audit templates config pages: category keys | Done |
| Seed data description | Done |
| Database: MAINTENANCE role description, field_id_config module names | Done |
| "No of Connections" → "Number of Parent Connections" | Done |
| All CLAUDE.md, CHANGELOG.md, DECISIONS.md updated | Done |

### Entity Template View Dialog

| Feature | Status |
|---------|--------|
| Eye icon button in template table actions | Done |
| Read-only view: Basic Info, Attributes, Telemetry, Identifiers, Alarm Rules | Done |
| "Edit Template" button to transition to edit dialog | Done |
| Badge colors removed — all badges use neutral slate styling | Done |

### Bug Fixes (Code Review)

| Fix | Severity | Status |
|-----|----------|--------|
| Added `enforceReauth` to POST/DELETE identifier endpoints (API) | CRITICAL | Done |
| Added `reauth.execute` wrappers to frontend identifier handlers | CRITICAL | Done |
| Added `await` to `reauth.execute` in handleDeleteRelationship (index.tsx) | CRITICAL | Done |
| Added `await` to `reauth.execute` in handleDelete (templates.tsx) | CRITICAL | Done |
| Added `CREATE_ASSET_IDENTIFIER` and `DELETE_ASSET_IDENTIFIER` to reauth-actions.ts | CRITICAL | Done |
| Exposed `category`, `expectedRelationships`, `statusLifecycle` in Zod + API | HIGH | Done |
| Added `maxConnections`, `telemetrySchema` to GET /templates response schemas | HIGH | Done |
| Fixed `parentId` null→empty string in GET /instances list response | HIGH | Done |

### Prior Work (Phase 1)

| Feature | Status |
|---------|--------|
| Dynamic Tree Diagram (add child, attach existing, remove from tree) | Done |
| Attach Existing Entity dialog (search + select + CONTAINS relationship) | Done |
| Sidebar tree node actions (create child, attach existing, unlink from parent) | Done |
| Diagram tree node actions (create child, attach existing, remove from tree) | Done |
| All 12 relationship types freely available in Link Entities dialog | Done |
| Template Linking Rules feature removed | Done |

---

## Current API Endpoint Summary (Entity Module)

| Group | Count | Endpoints |
|-------|-------|-----------|
| Templates | 6 | GET/POST `/templates`, GET/PUT/DELETE `/templates/:id`, GET `/templates/:id/versions` |
| Instances | 8 | GET `/instances`, GET `/instances/tree`, GET/POST/PUT/DELETE `/instances/:id`, PATCH `/instances/:id/status`, GET `/instances/:id/children` |
| Relationships | 3 | GET/POST `/relationships`, DELETE `/relationships/:id` |
| Identifiers | 4 | GET `/identifiers`, GET `/identifiers/lookup/:value`, POST/DELETE `/identifiers/:id` |
| **Total** | **21** | |

---

## How to Resume

### 1. Start the dev environment
```bash
cd /home/ubuntu/21cfrlogbook
npm run dev     # Start API + Web in dev mode
```

### 2. Or use production
```bash
pm2 restart digilog-api    # API on port 3000
# Web served by nginx on port 80 from apps/web/dist
```

### 3. Access points
- **Web App:** http://43.205.32.23
- **Swagger:** http://43.205.32.23/docs
- **Login:** admin / Admin@123

### 4. Key pages to test
- `/assets` — Entity Explorer with dynamic tree diagram
- `/config/roles` — Role management

---

## What's NOT Done / Potential Next Steps

1. **Inline Edit on tree nodes** — Double-click node name to rename asset inline
2. **Drag-and-drop tree reordering** — Rearrange tree nodes by dragging
3. **Bulk relationship operations** — Select multiple assets and create/delete relationships in batch

---

## Git Status
Branch: `feature/user-id-config` (not yet merged to `main`)
