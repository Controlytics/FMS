# Phase 5A Report — Gate Field + useCan() Hook

**Date:** 2026-06-30
**Branch:** RFID
**Status:** COMPLETE

---

## Commit Range

| SHA | Description |
|-----|-------------|
| `e70c2b2` | Task 5A.1 — gate field + resolveNodeGate helpers |
| `ef5dd9c` | Task 5A.2 — useCan() hook |
| `f3432d2` | Task 5A.3 — docs (CHANGELOG + shared/CLAUDE.md + todo.md) |

---

## What Was Done

### Task 5A.1 — gate field on PermissionNode

- **`PermissionNode` interface** in `packages/shared/src/types/permission-tree.ts` gained two new fields:
  - `gate: Permission[]` — the **discriminating backend permission set** (what `requirePermission` / `requireAnyPermission` actually checks). This is NOT the grant-expansion `permissions[]` set.
  - `gateRoles?: string[]` — additional roles that bypass the gate besides `SUPER_ADMIN` (only `system_health.view → ['ADMIN']` currently).

- **All 91+ nodes** in `PERMISSION_TREE` populated with correct gate values derived from backend route greps. Phase-3 delta overrides applied:
  - `users.delete`, `pm.delete`, `notifications.delete`, `audit.redact`, `audit.verify_chain` → `gate: []` (SA-only per M3/M4/M5)
  - Role-config endpoints → `gate: ['ROLE_MANAGE']` (M6)
  - `filters.status_update` → `gate: ['FILTER_STATUS_UPDATE']` (M1)
  - `report_reviews.view` → `gate: ['REPORT_REVIEW_SUBMIT', 'REPORT_REVIEW', 'REPORT_APPROVE']` (S4)

- **`resolveNodeGate(nodeId, tree?)`** — returns `Permission[]`; returns `[]` for unknown ids.
- **`resolveNodeGateRoles(nodeId, tree?)`** — returns `string[]`; returns `[]` for unknown ids.
- Both exported from `packages/shared/src/index.ts`.

TDD: 7 gate tests written first (`permission-tree.test.ts`), confirmed failing (`TypeError: resolveNodeGateRoles is not a function`), all pass after implementation. Existing 11 tests unchanged.

### Task 5A.2 — useCan() hook

- **`apps/web/src/hooks/use-can.ts`** — new hook returning `useCallback((nodeId) => boolean)`.
  Decision chain:
  1. `SUPER_ADMIN` → always `true`
  2. `gateRoles` present → `true` if `user.role` in list
  3. `gate.length === 0` → `false` (SA-only or unknown node — default-deny)
  4. OR over `gate` vs `user.permissions`

- **`apps/web/src/hooks/__tests__/use-can.test.ts`** — 13 test cases:
  - Phase-1 regression (USER_READ must not authorize `users.delete`)
  - SA bypass (SA can perform `gate:[]` actions)
  - OR-gate (holds either `FCP_CREATE` or `CHECKLIST_CREATE`)
  - Grant-set irrelevance (holding `USER_DELETE` from `permissions[]` still cannot bypass `gate:[]`)
  - gateRoles (ADMIN can view system health; OPERATOR cannot)
  - Unknown node ids → false
  - Null user → false for all

TDD: tests confirmed `module not found` before implementation, all 13 pass after.

### Task 5A.3 — Docs

- `CHANGELOG.md` — new `[Unreleased] Phase 5A` entry at top
- `packages/shared/CLAUDE.md` — `permission-tree.ts` row updated with Phase 5A details
- `tasks/todo.md` — new audit log entry

---

## Test Summary

| Suite | Before | After |
|-------|--------|-------|
| `permission-tree.test.ts` | 11 pass, 7 fail | **21 pass, 0 fail** (+3 gate-correction regression tests) |
| `use-can.test.ts` | module not found | **13 pass, 0 fail** |
| Other shared tests | 1 pre-existing fail (`assets.test.ts limit>100`) | unchanged |

Shared package build: `tsc` clean.

---

## Concerns / Notes

1. **`checklists.submit` gate — FIXED in gate-correction commit** — Originally set to `['CHECKLIST_SUBMIT']` (intent-based). Post-review, confirmed that `POST /api/filters/:id/submit-checklist` enforces `FILTER_OPERATE`, not `CHECKLIST_SUBMIT`. `CHECKLIST_SUBMIT` has no backend route enforcement. Fixed to `['FILTER_OPERATE']`. Regression test added.

2. **`assets.relationships.*` gates — FIXED in gate-correction commit** — `ASSET_RELATIONSHIP_CREATE` and `ASSET_RELATIONSHIP_DELETE` are grant-only perms with no dedicated backend enforcement. Relationship changes go through `PUT /api/assets/:id` (parentId change) which enforces `requireAnyPermission('ASSET_UPDATE', 'FILTER_EDIT', 'FILTER_HIERARCHY_EDIT')`. Both nodes fixed to `['ASSET_UPDATE', 'FILTER_EDIT', 'FILTER_HIERARCHY_EDIT']`. Regression tests added.

3. **Remaining theater permissions** — `RETIREMENT_LIST_EXPORT` has no backend route (client-side PDF). Set to `['ASSET_READ']` (page VIEW perm) — this is correct per the "no backend route → page VIEW perm" convention.

4. **OR-triple spot-check — CONFIRMED correct** — `assets.create` / `filters.create` / `filters.hierarchy_create` all use `gate: ['ASSET_CREATE', 'FILTER_CREATE', 'FILTER_HIERARCHY_CREATE']`. Verified against `instance.routes.ts:263` which is `requireAnyPermission('ASSET_CREATE', 'FILTER_CREATE', 'FILTER_HIERARCHY_CREATE')` — exact match.

5. **Pre-existing test failure** — `assets.test.ts > rejects limit over 100` was failing before this work and is unrelated to gate fields. Subtract before triaging.

6. **Additive only** — No pages wired to `useCan()`. Phases 5B–5E handle that.
