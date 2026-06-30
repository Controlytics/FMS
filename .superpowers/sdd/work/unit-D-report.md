# Unit D Report — Task 1.9 Verification + Docs Sync

Date: 2026-06-30

## Test Results (Phase 1 files)

| File | Suite | Pass | Fail |
|---|---|---|---|
| `packages/shared/src/types/permission-tree.test.ts` | `npm test -w @digilog/shared` | **11** | 0 |
| `packages/shared/src/types/roles.test.ts` | `npm test -w @digilog/shared` | **1** | 0 |
| `apps/api/src/__tests__/role-effective-permissions.test.ts` | `npm test -w @digilog/api -- role-effective-permissions` | **7** | 0 |
| `apps/web/src/__tests__/route-guard-coverage.test.ts` | `npm test -w @digilog/web -- route-guard-coverage` | **1** | 0 |

**All 4 Phase 1 test files pass. Total: 20 tests / 0 failures.**

## Shared Suite — Pre-Existing Failures (not caused by Phase 1)

The full `npm test -w @digilog/shared` run showed 3 failures in 2 files:

### `src/types/audit-templates.test.ts` — 2 failures
- `AUDIT_TEMPLATE_CATEGORIES > has 12 categories` — expected 12, got 13. A `Filter Management` category was added to `audit-templates.ts` (commit `f3d066d fix(audit): identifier rows + entity→filter wording` — predates Phase 1 by many commits). The test was not updated to match.
- `AUDIT_TEMPLATE_DEFAULTS > contains Entity Management actions` — test still expects `'Entity Management'` but the source now says `'Filter Management'` after the same rename in `f3d066d`.

**Why pre-existing:** `git log -- packages/shared/src/types/audit-templates.ts` shows last change in `f3d066d` (before Phase 1 commits began at `3c66cc3`). Phase 1 files are `roles.ts`, `permission-tree.ts`, `index.ts` — none of these were touched for these failures.

### `src/schemas/assets.test.ts` — 1 failure
- `assetQuerySchema > rejects limit over 100` — schema allows >100 but test expects rejection. Unrelated to permission system entirely.

**Why pre-existing:** `git log -- packages/shared/src/schemas/assets.ts` confirms last change predates Phase 1. No Phase 1 file touches this schema.

## Type File Count (verified by `ls packages/shared/src/types/*.ts | grep -v test`)

11 non-test type files (was 10 before Phase 1 added `permission-tree.ts`):

1. `action-tape.ts`
2. `audit-actions.ts`
3. `audit-templates.ts`
4. `feature-privileges.ts`
5. `permission-categories.ts`
6. `permission-tree.ts` ← Phase 1 addition
7. `permissions.ts`
8. `reauth-actions.ts`
9. `roles.ts`
10. `sidebar-items.ts`
11. `sidebar-privilege-map.ts`

Note: `alarm-columns.ts` listed in the old table does NOT exist on disk; removed from table.
`action-tape.ts` existed but was missing from the old table; added.

## Docs Updated
- `CHANGELOG.md` — top entry added dated 2026-06-30 "Sidebar RBAC — Phase 1 (catalog foundation)"
- `packages/shared/CLAUDE.md` — Live Type Inventory count corrected 10→11; `alarm-columns.ts` row removed; `action-tape.ts` row added; `permission-tree.ts` row added
- `tasks/todo.md` — audit-log entry appended for Phase 1 completion

## Commit Hash

`2b09a40` — `docs(rbac): record Phase 1 catalog addition + sync shared type inventory`
