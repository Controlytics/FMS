# Unit A Report — PERMISSION_TREE Phase 1

**Date:** 2026-06-30
**Branch:** RFID
**Commit range:** `6ae3b1a..6f9a409`

---

## Status: DONE (1 task BLOCKED)

| Task | Status | Notes |
|------|--------|-------|
| 0.1 — Fix DEFAULT_ROLE_HIERARCHY | DONE | Fixed SUPERVISOR:3→4, MAINTENANCE:2→3, OPERATOR:1→2, VIEWER:0→1 in roles.ts to match seed.ts |
| 1.1 — PERMISSION_TREE + well-formedness | DONE | 24 groups, 98 FP nodes + enforced-only nodes; 5 well-formedness tests PASS |
| 1.2 — deriveFeaturePrivileges parity | DONE | Test + fix (oracle-ordered iteration); PASS |
| 1.3 — deriveFeatureToPermissionMap parity | DONE | Test; PASS (implementation was already correct in 1.1) |
| 1.4 — deriveSidebarPrivilegeMap parity | BLOCKED | Test committed with EXPECTED FAIL label — see below |
| 1.5 — resolveNodePermissions | DONE | 3 tests; PASS |

---

## Test Summary

**11 tests total. 10 passed, 1 intentionally-failing BLOCKED test.**

```
PERMISSION_TREE well-formedness > has unique node ids                              ✓
PERMISSION_TREE well-formedness > every node id is dotted lowercase (page.action)  ✓
PERMISSION_TREE well-formedness > every permission referenced exists in PERMISSIONS ✓
PERMISSION_TREE well-formedness > every reauthAction (when set) exists in REAUTH_ACTIONS ✓
PERMISSION_TREE well-formedness > every node has a valid enforce tag               ✓
deriveFeaturePrivileges parity (Task 1.2) > reproduces FEATURE_PRIVILEGES exactly  ✓
deriveFeatureToPermissionMap parity (Task 1.3) > reproduces FEATURE_TO_PERMISSION_MAP exactly ✓
deriveSidebarPrivilegeMap parity (Task 1.4) > [EXPECTED FAIL — structural contradiction] ✗ BLOCKED
resolveNodePermissions (Task 1.5) > returns permissions for a known FP node        ✓
resolveNodePermissions (Task 1.5) > returns [] for an unknown node id              ✓
resolveNodePermissions (Task 1.5) > returns [] for an enforced-only node           ✓
```

---

## Commit Log

| Hash | Task | Description |
|------|------|-------------|
| `6ae3b1a` | 0.1 | fix(rbac): reconcile role-hierarchy mismatch between roles.ts and seed.ts |
| `3b5beb4` | 1.1 | feat(shared): add PERMISSION_TREE skeleton + well-formedness tests |
| `e993ede` | 1.2+1.3 | feat(shared): parity tests for deriveFeaturePrivileges and deriveFeatureToPermissionMap |
| `3c66cc3` | 1.4+1.5 | feat(shared): Task 1.4 (BLOCKED) + 1.5 (PASS) — sidebar parity + resolveNodePermissions |
| `6f9a409` | barrel | feat(shared): export PERMISSION_TREE + derive functions from barrel (index.ts) |

---

## BLOCKED: Task 1.4 — deriveSidebarPrivilegeMap

### Root cause: many-to-many vs. one-to-one structural mismatch

The `SIDEBAR_PRIVILEGE_MAP` oracle uses a **many-to-many** mapping — the same
FP id appears in multiple sidebar sections. The `PERMISSION_TREE` is a
**one-to-one** mapping — each node id must be unique (enforced by the
well-formedness test). These two invariants are mutually exclusive.

### Specific duplicate FP ids in the oracle

| FP id | Oracle sections it appears in |
|-------|-------------------------------|
| `assets.view` | filter-list, filter-retirements, rfid-track-record, filter-replacements |
| `filters.operate` | filter-list, filter-operations |
| `filters.events` | filter-list, filter-operations |
| `filters.rfid_manage` | filter-list, rfid-track-record |
| `checklists.submit` | checklists, filter-operations |
| `cycles.view` | cleaning-cycles, filter-lifecycle-report |
| `pm.view` | pm-schedules, my-tasks, deviations |
| `pm.approve` | pm-schedules, deviations |
| `pm.execute` | my-tasks |

### Additional mismatches (oracle has fewer ids per section than tree groups do)

The oracle's `configuration` section only lists `["config.view", "config.edit"]`
but the tree's `configuration` group also contains `config.field_ids`, `roles.manage`,
`backup.export`, `backup.restore` as FP nodes. Similar gaps exist for `filter-list`
(oracle omits `assets.create/edit/delete`, `filters.create/edit/delete`, etc.) and
for `pm-schedules` (oracle omits `pm.edit`, `pm.delete`, `pm.download_template`,
`pm.upload`, `pm.edit_entry`, `pm.resubmit`).

### Resolution path for Phase 2

To make derivation work, one of the following structural changes is needed:

**Option A — Add `alsoIn: string[]` field to PermissionNode**
Each node gets a secondary list of sidebarIds where it also appears.
`deriveSidebarPrivilegeMap` collects primary + secondary placements.
Pros: tree remains primary source; no duplicate nodes.
Cons: the "also-in" data is oracle-derived metadata, not semantically meaningful.

**Option B — Make SIDEBAR_PRIVILEGE_MAP non-derived (keep as manual oracle)**
Accept that SIDEBAR_PRIVILEGE_MAP cannot be derived from the tree and keep it
as a maintained-by-hand mapping. The tree is the source of truth for
permissions/reauth; SIDEBAR_PRIVILEGE_MAP is the source of truth for the
role-access UI layout. These are orthogonal concerns.
Pros: cleaner separation; no structural compromise.
Cons: two sources to keep in sync; no automated drift detection.

**Option C — Restrict SIDEBAR_PRIVILEGE_MAP to primary placement only**
Remove the duplicate ids from SIDEBAR_PRIVILEGE_MAP (e.g., only `filter-list`
gets `assets.view`; `filter-retirements` gets no privilege ids). This makes
derivation exact but reduces the helpfulness of the role-access UI (admins
can't see that `assets.view` is relevant to multiple pages).

Recommendation: **Option B** — preserve SIDEBAR_PRIVILEGE_MAP as-is for
the role-access UI while using the tree for permission enforcement.

---

## Note on Task 1.5 oracle correction

The plan's sample test expected `resolveNodePermissions('users.delete')` → `['USER_DELETE']`.
The `FEATURE_TO_PERMISSION_MAP` oracle says `users.delete` maps to `['USER_DELETE', 'USER_READ']`.
Per "the oracle always wins," the test was written with the oracle-correct value
`['USER_DELETE', 'USER_READ']`. The function returns the node's `permissions` array
verbatim, which correctly includes `USER_READ` (the read-permission guard that prevents
privilege-escalation via delete-without-read). NOT BLOCKED; test passes.

---

## Files created / modified

| File | Change |
|------|--------|
| `packages/shared/src/types/roles.ts` | Fixed DEFAULT_ROLE_HIERARCHY (Task 0.1) |
| `packages/shared/src/types/roles.test.ts` | NEW — Task 0.1 parity test |
| `packages/shared/src/types/permission-tree.ts` | NEW — interfaces, PERMISSION_TREE, 4 derive functions |
| `packages/shared/src/types/permission-tree.test.ts` | NEW — 11 tests across Tasks 1.1–1.5 |
| `packages/shared/src/index.ts` | Added barrel exports for tree + derive functions |
