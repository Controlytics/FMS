# Tablet stage approvals - approve / reject verified server-side (2026-09-04)

Open since 2026-09-02: the Shift Officer's tablet tab for cleaning-stage
approvals was built, but the approve / reject WRITE had never been exercised.
Verified today on a pg_dump clone of the live DB (`digilog_sa_test`) behind a
second API on :3002, with a throwaway OPERATOR (990109) and SHIFTOFFICER
(990110). The tablet posts exactly what this run posted:
`POST /api/stage-approvals/:id/{approve|reject}` with `remarks` and the
signature password. Clone, temp users and dump removed afterwards; the live DB
has zero residue.

Profile in play: `CWH` (WASH_IN -> STORAGE_IN -> STORAGE_OUT -> DRY_OUT), so
the interlock point is DRY_OUT and a reject sends the filter back to DRY_IN.

| Check | Result | Evidence |
|---|---|---|
| Entering the interlock stage raises a PENDING request for SHIFTOFFICER (filters A and B) | PASS | rows 44249bf1 / a15acb06, stage DRY_OUT |
| Operator is gated while pending (only Terminate offered) | PASS | actions = [Terminate Cycle] |
| SO queue lists both; rows carry `selfRequested:false`, no `requestedBy` | PASS | server-computed flag |
| Operator (requester) cannot approve own request | PASS | 403 |
| Operator cannot read the queue at all | PASS | 403 (no STAGE_APPROVAL_VIEW) |
| Approve without the signature password | PASS | 401 REAUTH_REQUIRED |
| Reject without remarks | PASS | 400 VALIDATION_ERROR |
| Refusals decided nothing (both still PENDING) | PASS | |
| **Approve A** -> 200 APPROVED | PASS | |
| DB row APPROVED, decided_by_name 990110, decision_remarks kept | PASS | |
| APPROVAL_GRANTED filter event on this cycle | PASS | 1 |
| Audit STAGE_APPROVAL_APPROVED, user_id 990110, role SHIFTOFFICER, meaning "Dry Out approved for filter ..." | PASS | (user_name column is empty across the whole trail - user_id carries the username; convention, not a defect) |
| Operator released: Storage In offered; A advances DRY_OUT -> STORAGE_IN | PASS | 200 |
| **Reject B** -> 200 REJECTED | PASS | |
| B sent back DRY_OUT -> DRY_IN; STATE_TRANSITION event written | PASS | |
| Audit STAGE_APPROVAL_REJECTED by 990110 with the remarks | PASS | |
| Queue empty afterwards; history shows APPROVED + REJECTED | PASS | |
| Approving an already-decided request | PASS | 400 INVALID_STATUS |
| B re-cleans (WASH_IN -> DRY_OUT) and a NEW pending request is raised | PASS | row 70305b9f |

**Verdict: 21 of 21 server-side checks pass.** What this cannot prove is the
physical tap on a tablet; the code path from the tap to these endpoints is
`mobile-wrapper.tsx` (`saDlg` -> `reauth.execute` -> `apiClient.postWithReauth`).
