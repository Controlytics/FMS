# DigiLog — Session Resume Point

**Last Updated:** 2026-02-19
**Branch:** `feature/user-id-config`
**Status:** All features implemented and tested. Ready for next phase.

---

## What Was Completed

### Template Linking Rules + Dynamic Tree Management (8 Phases)

All 8 phases of the feature are **complete**:

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Database — `TemplateLinkingRule` model + `allowCrossTemplateLinking` on Role | Done |
| 2 | Shared Package — schemas, permissions, audit actions, reauth actions | Done |
| 3 | Backend — 5 linking rule endpoints + validation engine + integration into POST /relationships | Done |
| 4 | Role Configuration — `allowCrossTemplateLinking` toggle in role create/edit | Done |
| 5 | Template Linking Rules Config Page (`/config/template-linking-rules`) | Done |
| 6 | Dynamic Tree Diagram (add child, attach existing, remove from tree, linking rule UI enforcement) | Done |
| 7 | Audit Trail Integration (3 new audit actions, blocked attempt logging) | Done |
| 8 | Edge Cases (rule deletion fallback, template rename safety, role change immediate effect, backwards compat) | Done |

### Test Results
- **70/70 tests passed** (50 positive + 12 negative + 8 setup/cleanup)
- Full report: `TREE_DIAGRAM_TEST_REPORT.md`

---

## Files Modified (from `main` branch)

### Database
- `apps/api/prisma/schema.prisma` — Added `TemplateLinkingRule` model, `allowCrossTemplateLinking` on Role, relations on AssetTemplate

### Shared Package (`packages/shared/`)
- `src/schemas/assets.ts` — Added `LINKING_RULE_SCOPES`, `createTemplateLinkingRuleSchema`, `updateTemplateLinkingRuleSchema`
- `src/types/permissions.ts` — Added `TEMPLATE_LINKING_RULE_MANAGE`
- `src/types/permission-categories.ts` — Added to Asset Management category
- `src/types/audit-actions.ts` — Added `TEMPLATE_LINKING_RULE_CREATED/UPDATED/DELETED`
- `src/types/reauth-actions.ts` — Added `CREATE/UPDATE/DELETE_TEMPLATE_LINKING_RULE`
- `src/types/audit-templates.ts` — Added 3 linking rule templates
- `src/index.ts` — Exports for new schemas/constants

### Backend (`apps/api/`)
- `src/modules/assets/routes.ts` (~2057 lines) — Added 5 linking rule endpoints, `validateLinkingRule()` helper, integration into POST /relationships, duplicate prevention
- `src/lib/swagger.ts` — Added "Template Linking Rules" tag
- `prisma/seed.ts` — Added `TEMPLATE_LINKING_RULE_MANAGE` to SUPER_ADMIN and ADMIN default permissions

### Frontend (`apps/web/`)
- `src/main.tsx` — Added route for `/config/template-linking-rules`
- `src/routes/config/template-linking-rules.tsx` (NEW, ~449 lines) — SUPER_ADMIN config page
- `src/routes/assets/index.tsx` (~2993 lines) — Dynamic tree diagram with add/attach/remove, linking rule enforcement in Link dialog, Attach Existing Asset dialog
- `src/routes/config/roles.tsx` — `allowCrossTemplateLinking` toggle in role create/edit dialogs
- `src/routes/config/action-reauth.tsx` — Updated for new reauth actions

### Documentation
- `CLAUDE.md` (root) — Updated assets section, model count, endpoint count, tree diagram docs
- `apps/api/CLAUDE.md` — Updated asset module docs (26 endpoints, linking rules section)
- `apps/web/CLAUDE.md` — Updated asset pages, tree diagram, config pages, attach existing dialog
- `packages/shared/CLAUDE.md` — Updated permissions, audit actions, schemas, reauth actions
- `apps/api/DECISIONS.md` — Added decisions #20-23 (linking rules, duplicate prevention, role bypass, dual hierarchy)
- `apps/web/DECISIONS.md` — Added decisions #18-20 (tree diagram actions, attach existing, rule enforcement UI)
- `TREE_DIAGRAM_TEST_REPORT.md` — Full 70-test report

---

## Current API Endpoint Summary (Asset Module)

| Group | Count | Endpoints |
|-------|-------|-----------|
| Templates | 6 | GET/POST `/templates`, GET/PUT/DELETE `/templates/:id`, GET `/templates/:id/versions` |
| Instances | 8 | GET `/instances`, GET `/instances/tree`, GET/POST/PUT/DELETE `/instances/:id`, PATCH `/instances/:id/status`, GET `/instances/:id/children` |
| Relationships | 3 | GET/POST `/relationships`, DELETE `/relationships/:id` |
| Identifiers | 4 | GET `/identifiers`, GET `/identifiers/lookup/:value`, POST/DELETE `/identifiers/:id` |
| Linking Rules | 5 | GET `/linking-rules`, GET `/linking-rules/validate`, POST `/linking-rules`, PUT/DELETE `/linking-rules/:id` |
| **Total** | **26** | |

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
- `/assets` — Asset Explorer with dynamic tree diagram
- `/config/template-linking-rules` — Template Linking Rules config (SUPER_ADMIN only)
- `/config/roles` — Role management with `allowCrossTemplateLinking` toggle

---

## What's NOT Done / Potential Next Steps

1. **Inline Edit on tree nodes** — Double-click node name to rename asset inline (Phase 6 stretch goal, not implemented)
2. **Drag-and-drop tree reordering** — Rearrange tree nodes by dragging
3. **Bulk relationship operations** — Select multiple assets and create/delete relationships in batch
4. **Rule import/export** — Export linking rules as JSON, import into another deployment
5. **Linking rule audit UI** — Dedicated view in audit trail filtered to linking rule changes
6. **Template deletion cascade to rules** — Currently handled by Prisma `onDelete: Cascade` on the FK. Could add a UI warning showing how many rules will be affected before deleting a template.

---

## Git Status
Branch: `feature/user-id-config` (not yet merged to `main`)
All changes are uncommitted. To commit:
```bash
git add -A
git commit -m "Template Linking Rules + Dynamic Tree Management"
```
