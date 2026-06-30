# Phase 5C — Report Reviews button gating via useCan()

**File:** `apps/web/src/routes/report-reviews/index.tsx`
**Date:** 2026-06-30
**Pattern commit:** `5963227` (Users pilot)

---

## Summary

Added `useCan()` gating to all action buttons on the Report Reviews page. All three
were UNGATED before (any user who passed the route guard could see and click them).

---

## Buttons changed

| Button | Was | Now | Direction | Flag |
|---|---|---|---|---|
| Review (queue, REVIEW stage) | UNGATED | `can('report_reviews.review')` = gate `['REPORT_REVIEW']` | UNGATED→gated | CORRECTION |
| Approve (queue, APPROVAL stage) | UNGATED | `can('report_reviews.approve')` = gate `['REPORT_APPROVE']` | UNGATED→gated | CORRECTION |
| Reject (all queue stages) | UNGATED | stage-dependent (see below) | UNGATED→gated | CORRECTION + tree gap |
| Download PDF (All tab) | UNGATED | `can('report_reviews.view')` = gate `['REPORT_REVIEW_SUBMIT','REPORT_REVIEW','REPORT_APPROVE']` | UNGATED→gated | CORRECTION |

---

## Reject button — tree gap

The `report_reviews.reject` permission-tree node has gate `['REPORT_APPROVE']`.
This is incomplete: the backend `/review` endpoint (stage=REVIEW) accepts
`action: 'reject'` and requires `REPORT_REVIEW`, not `REPORT_APPROVE`. Using
the tree node directly would silently strip Reject from REPORT_REVIEW-only
reviewers — the opposite of correct.

**Resolution:** Reject is gated stage-dependently, identical to the primary action:
```
canAct = r.stage === 'REVIEW'
  ? can('report_reviews.review')   // /review endpoint — REPORT_REVIEW
  : can('report_reviews.approve'); // /approve endpoint — REPORT_APPROVE
```

Both the primary button and Reject use `canAct`. This matches backend enforcement exactly.

**Tree gap to fix separately:** `report_reviews.reject` node's gate should be
`['REPORT_REVIEW', 'REPORT_APPROVE']` (OR, since either holder can reject at
their stage). Left unfixed here per scope — it is never queried in this commit.

---

## Lint

`npm run lint -w @digilog/web` (tsc --noEmit) — clean, no errors.
