# Admin requests — audit attribution + honest account-state actions

**Ask (operator, 2026-09-02):**
1. The two admin-request audit records don't show the **requesting** user's ID
   and role — only a quoted name — and the "by" should be the verified ID.
2. A user asked to **unlock an account that was not locked**; approving it
   reported the account unlocked. It should say the account was not locked.
3. Add **Enable Account** and **Disable Account** request types, with
   "already enabled" / "already disabled" outcomes.

## What I found (verified against live code + DB + the running app)

### The "already enabled" guard has been dead since 2026-05-20

`contact-admin.tsx:169` is
`lookupUser?.status === 'ENABLED'`, but `GET /api/admin-requests/user-lookup`
**does not return `status`**. It was deliberately narrowed to
`{exists, username, fullName}` (security fix H1) because a distinguishable
response is an unauthenticated enumeration oracle. Fastify strips fields absent
from the response schema, so `lookupUser.status` is always `undefined` and
`isAlreadyEnabled` is **always false**. Live check:

```
GET /user-lookup?username=101010 -> {"exists":true,"username":"101010","fullName":"Admin User"}
```

So the form accepts an unlock request for any account, and
`executeApproval`'s `UNLOCK` case has **no state check at all** — it calls
`userService.unlock()` unconditionally, which resets the password, forces a
change, terminates every session and writes `ACCOUNT_UNLOCKED` claiming
`status: 'ENABLED'`. On a healthy account that is a destructive no-reason
password reset plus a false §11 record.

### What the audit rows actually contain

| | `user_id` | `user_role` | rendered |
|---|---|---|---|
| `ADMIN_REQUEST_SUBMITTED` | `101010` (requester) | **empty** | `Admin request submitted — "Unlock Account — Admin User (101010)"` |
| `ADMIN_REQUEST_APPROVED` | `101010` (approver) | `ADMIN` | `Admin request approved — "…" by 101010` |

The submit path passes `userId` but never `userRole`. Neither template exposes
the requester's id/role as fields — they are only inside the quoted name. The
description is also CSS-truncated in the table, so `by <approver>` is cut off.

(No IP is rendered anywhere in these rows — `{actor}` is `record.userId`. The
operator's "not verified ip" remark is therefore ambiguous; wording to be
confirmed against concrete before/after samples rather than guessed.)

## Decisions

1. **Every state check is SERVER-side, at approval time. `/user-lookup` is NOT
   widened.** "Is this account locked / disabled" is precisely the signal an
   enumeration attacker wants. The approver is authenticated and the state is
   current at approval; the form is the wrong place. The dead `isAlreadyEnabled`
   code is **deleted**, not left — leaving it implies a protection that does not
   exist, which is how it survived four months.

2. **A no-op must not write the action's audit row.** The guard returns *before*
   `userService.unlock/enable/disable`, so no `ACCOUNT_UNLOCKED` / `USER_ENABLED`
   / `USER_DISABLED` row is written for something that did not happen. The
   `ADMIN_REQUEST_APPROVED` row IS still written — the admin did decide — with
   `actionTaken: false` and the reason.

3. **Only `LOCKED` is unlockable.** `EXPIRED` is a no-op that names the status
   and points at Forgot Password. Unlocking an EXPIRED account would silently
   perform a password reset nobody requested — the same class of surprise as the
   bug being fixed.

4. **Role hierarchy is checked BEFORE the state check.** `assertCanManageTarget`
   lives inside `unlock/enable/disable`, so guarding first would skip it and let
   an ADMIN learn a SUPER_ADMIN's account state via the no-op message. It is
   exported and called first for every user-targeting request type.

5. **`requesterRole` is resolved server-side** from `requesterEmployeeId` at both
   submit and approve time, never trusted from the client, and stored in the
   audit `afterValue` only — **not** in `requestData` (that is the submitted
   payload). No migration needed.

6. **`{targetName}` is left intact** so existing rows keep rendering; new fields
   are added as a `{requesterClause}` in the `{parentClause}` idiom, which
   degrades to just the id when the role is unknown (every pre-change row).

## Steps

- [x] 1. Export `assertCanManageTarget` from `user.service.ts`
- [x] 2. `admin-request.service.ts` — resolve `requesterRole`; add it to both audit rows
- [x] 3. `executeApproval` — `UNLOCK` guard (LOCKED only; EXPIRED/ENABLED/DISABLED no-op)
- [x] 4. `executeApproval` — new `ENABLE_ACCOUNT` / `DISABLE_ACCOUNT` cases with already-in-state no-ops
- [x] 5. `formatRequestType` + route schema enum + `REQUEST_TYPES` on the form (4 gates, all of them)
- [x] 6. `audit-templates.ts` — new wording; register `{requesterClause}`/`{actorRole}` in `replacePlaceholders`
- [x] 7. Delete the dead `isAlreadyEnabled` code
- [x] 8. Tests + live verification
- [ ] 9. Show the operator concrete before/after audit strings and confirm wording

## Not doing

- Widening `/user-lookup` (re-opens the enumeration oracle).
- A schema migration for `requesterRole` (audit `afterValue` carries it).
