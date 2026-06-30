# Phase 5C — Approvals Page Button Gating via useCan()

**Page:** `apps/web/src/routes/approvals/index.tsx`  
**Date:** 2026-06-30

## Gate analysis

| Button | Old gate | Tree node | Node gate | useCan result | Status |
|--------|----------|-----------|-----------|---------------|--------|
| Approve | `role==='SUPER_ADMIN' \|\| permissions.includes('BLOCK_CHANGE_APPROVE')` | `block_change.approve` | `['BLOCK_CHANGE_APPROVE']` | `can('block_change.approve')` — SA bypass via useCan line 32 | **SAME** |
| Reject  | `role==='SUPER_ADMIN' \|\| permissions.includes('BLOCK_CHANGE_APPROVE')` | `block_change.reject`  | `['BLOCK_CHANGE_APPROVE']` | Container gated by `can('block_change.approve')`; both nodes share the same gate so the result is logically identical to `can('block_change.reject')` | **SAME** |

## Changes made

- Added `import { useCan } from '@/hooks/use-can';`
- Added `const can = useCan();` after `useToast()`
- Replaced `{isApprover && r.status === 'PENDING' && (` on the Approve/Reject button container with `{can('block_change.approve') && r.status === 'PENDING' && (`

## `isApprover` retention

`isApprover` is **not removed** — it is still needed for data-layer decisions that are outside button-gating scope:
- `swrKey` (`&mine=true` suffix) — controls whether the list shows own requests or all requests
- `pendingData` SWR key (only fetch pending-count for approvers)
- Header subtitle text
- Pending count badge visibility

The existing comment at line 30–35 (explaining why SUPER_ADMIN needs explicit inclusion for `isApprover`) remains valid for those uses.

## CHANGED / Flagged buttons

None. Both buttons are SAME.
