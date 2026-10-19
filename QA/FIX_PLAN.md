# QA — Fix Plan ("fix everything", operator 2026-10-19)

Scope = every bug in `DEFECT_REGISTER.md` and the open list given on 2026-10-19, EXCEPT the items in §4.
SUPER_ADMIN runtime testing is set aside (operator); SUPER_ADMIN-only fixes are verified in-process on
`digilog_test_db` with the suite's own fixture, not with `qa_sa_01`.

## 1. Rules for every fix

1. **Re-verify first.** Read today's code for the item and mark it STILL OPEN / ALREADY FIXED / NOT A
   DEFECT in the register. (The July audit refuted ~17 % of its own findings; one sweep claim here was
   already overstated.) Only STILL OPEN items are edited.
2. **List the touchpoints** before editing (CLAUDE.md "Correctness").
3. **Regression test** that fails without the fix; CHANGELOG entry; register row → FIXED with file list.
4. **No schema migrations** unless unavoidable; races are closed with a transaction + row lock /
   advisory lock, not a new unique index.
5. **Suites run single-fork after each batch**, never while another agent edits the tree.
6. Runtime re-check on the QA clone (:3104) after rebuilding `dist`.
7. Tablet-side fixes are listed separately → one APK rebuild at the end (operator installs).

## 2. Duplicates merged (fixed once)

| Kept as | Same as |
|---|---|
| CS-102 / M51 (disk health uses `wmic` on C:) | — |
| F-13 / M47 (system-role delete) | — |
| R-01..R-04 / M73 (gated saves without re-auth prompt) | — |
| OQ-11 / M80 (PM detail page unlinked) | — |
| OQ-04 / F-05 (tablet access fails open offline) | — |
| OQ-18 / BR-061 (filter approval, same person) | — |
| M43 (PM due list loads every cycle) | **already fixed 2026-10-17** |

## 3. Batches (in order)

**Batch 1 — server correctness**
QA-D001 PM execution start race · QA-D004 block-change request race · QA-D003 validation for the 12
dynamic config defs (schemas written to accept every value already stored on the clone and every payload
the pages send; partial-save merge kept) · typed filter create must refuse an inactive AHU · M11/M29
malformed id or query → 400/404 instead of 500 + false SYSTEM_ERROR · M15/M23 cleaning-profile and
filter-profile PUT schemas match their POST rules · M50 Filter Data Management generic saves validate
values · M27 filter cannot be soft-deleted mid-cycle · M37 failed Replace compensates fully · M87
double-click creates two cleaning profiles · password-reuse 12-month cap · notification retries
survive a restart (or mark the row failed) · M51 disk health without `wmic` · M47 system-role delete
guard · M55 orphan photo files · M89 AHU "Recent Activity" id · sanitizer coverage (code or doc,
whichever is wrong).

**Batch 2 — frontend workflow blockers (web; tablet where shared)**
QA-D002 stage screen mounts the PM / AHU set / remaining-filters dialogs · re-auth prompt on
Replacement Schedule upload, Pagination save, FDM unretire + manual retirement/replacement create, and
the other M73 paths · FDM lifecycle-step delete hits the event endpoint · SIGNATURE checklist question
gets an input (web + tablet) · export cancel handled on the six report pages · Filters page re-auth
prompt names the real action · RFID normaliser on every scan path · Tablet Access page write gate ·
system roles hide Delete · backup picker accepts `.dump` · "Send for Review" (enable or remove —
see §4 question if it turns out to be deliberate).

**Batch 3 — OQ list (2026-10-12/13), each re-verified**
Tablet: approval banner, Stage Approvals tab / Replacement Tasks tile visibility, Perform opens Wash
In, overdue Perform skips password, login ends the other session silently · PM: "QA approval" text,
edit toast, rejection remarks shown on screen, detail page linked · Web: idle timer uses the session
setting, no "Perform" on Not Performed, Equipment Groups back arrow, menu/page title, Excel export
honours "PDF only", hidden pages refused by URL · Admin requests: enable/disable labels.

**Batch 4 — error states, UX, performance (July mediums)**
M63/M66/M79/M82 fetch errors shown as errors, not empty pages or spinners · M10 RFID Track Record
paging · M70 audit search debounce · M88 cleaning-profile search server-side · M90 filter-list memo ·
M30 one notification-visibility rule · M32 notification unit tests · M58 contact-admin fields · M62
badge contrast · M74 backup error codes · M76 Configuration Access delegation · cancelled password
prompt not shown as a red error · remaining sweep UX items.

## 3b. Operator answers (2026-10-19)

| Question | Answer |
|---|---|
| Commit the 2026-10-17 batch first? | **"first fix everything"** — no commit until the fixes are done; each fix's files are listed in the register so the diffs stay separable on paper |
| Cycles view window | **Keep 30 days** (closed; not a defect) |
| Filter approval separation of duties | **Yes, require a different person** → added to Batch 1 |
| Offline code | **Only access + cache**: fix OQ-04 (tablet access fails open offline) and M53 (retired filters never evicted from the tablet cache); **OQ-01 offline approval skip stays as designed** (DOCUMENTED DECISION) |
| OQ-17 sidebar toggle vs URL | **Visibility only**; align the page guards that disagree with the permission rules |
| OQ-15 page title | **Rename to "Filter Cleaning Record"** (page + PDF/Excel default; custom Report Labels still win) |
| M80 / OQ-11 PM detail page | **Link it** from the PM Schedules list |
| OQ-07 tablet silent force login | **Ask first, like the web** (APK rebuild) |
| Deliberate, left alone (re-check found the decision in code/CHANGELOG) | OQ-03b Replacement Tasks open to every tablet role; C-14 Send for Review hidden; M55 no upload rate limit (fix orphan files only); M58 contact-admin hides account state; M10 RFID list uncapped |

## 4. Not in this plan unless the operator says so

| Item | Why |
|---|---|
| 11 MB tablet payload reshape; second API process | design / infrastructure change, not a bug fix |
| M06 setup guide, M07 CI pipeline | documentation / tooling work |
| Offline surface (OQ-01 offline approval skip, OQ-04 offline access fail-open, M53 cache eviction) | protected surface — operator question |
| Cycles view window, filter-approval separation of duties | operator decisions — question |
| SUPER_ADMIN audit hard-delete gate, notification test-fire | open operator decisions of 2026-07-15 |

## 5. Commit order

The 2026-10-17 load-test fixes (32 files) are uncommitted. New fixes should land after that batch is
committed so the two diffs stay separable (operator question). Each batch is committed separately when
the operator asks; the operator pushes.
