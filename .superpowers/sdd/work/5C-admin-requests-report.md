# Phase 5C — Admin Requests Button Gating Report

## Status: COMPLETE

## File changed
`apps/web/src/routes/admin-requests/index.tsx`

## Gate analysis

| Button | Old gate | Tree node | Tree gate | Direction |
|--------|----------|-----------|-----------|-----------|
| Approve | `isSuperAdmin \|\| perms.includes('ADMIN_REQUEST_REVIEW')` | `admin_requests.approve` | `['ADMIN_REQUEST_REVIEW']` | SAME |
| Reject  | `isSuperAdmin \|\| perms.includes('ADMIN_REQUEST_REVIEW')` | `admin_requests.reject`  | `['ADMIN_REQUEST_REVIEW']` | SAME |

Both nodes carry the same gate. `useCan()` internally handles SUPER_ADMIN bypass, so no logic change.

## Changes made

- Swapped `import { useAuth }` for `import { useCan }`.
- Removed `const { user }`, `const isSuperAdmin`, `const perms`, and the single `canApprove` bool.
- Added `const can = useCan()`, `const canApprove = can('admin_requests.approve')`, `const canReject = can('admin_requests.reject')`.
- Table "Review/View" label: `isPending && canApprove` → `isPending && (canApprove || canReject)`.
- Textarea section outer guard: `canApprove && ...PENDING` → `(canApprove || canReject) && ...PENDING`.
- Footer section outer guard: same change; Reject button wrapped in `{canReject && ...}`, Approve button wrapped in `{canApprove && ...}`.

## Flagged items
None. No UNGATED, BROADEN, or LOOSEN conditions found.
