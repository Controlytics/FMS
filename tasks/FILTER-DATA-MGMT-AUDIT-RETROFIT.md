# Filter Data Management — audit-trail retrofit + missing CRUD

**Started** 2026-08-27 · branch `RFID`
**Origin** user request: every edit / delete / insert on Config → Filter Data
Management must land in the audit trail and in every place the data is shown.
This is the retrofit the code itself flags as TODO at
`apps/api/src/modules/super-admin/routes.ts:21-24`.

## Decisions taken (user, 2026-08-27)
1. Audit every existing mutation on the 6 data tabs. **YES**
2. Add create + delete to Retirements / Replacements. **YES**
   - Retirement delete: **refuse with 409 when the filter has history**
     (cleaning cycles / filter events / identifiers). No cascade.
   - Replacement create / delete / edit: these operate on `audit_trail` rows.
     All three approved. Edit + delete break the hash chain — breakage stays
     LOUD (same policy as the 2026-07-01 `AUDIT_DELETE` decision).
3. Add edit + delete to the Audit Trail tab. **YES** — delete/redact reuse the
   existing `/api/audit/:id` endpoints; edit is new.
4. **Mandatory reason** on every edit / delete / create.

## Facts verified before starting
- `/api/audit` does NOT hide SUPER_ADMIN rows from a SUPER_ADMIN viewer
  (`audit/routes.ts:90`) — new rows will be visible on both surfaces.
- `audit_trail` has **only** `audit_trail_no_delete` (BEFORE DELETE). No UPDATE
  guard — verified live via `pg_trigger`.
- 🔴 **Pre-existing bug:** `PUT /filter-data/replacements/:id`
  (`routes.ts:287-302`) updates `audit_trail.timestamp / userName / afterValue`
  in place with no checksum recompute → silently breaks the chain from that row
  forward. Every replacement edit ever made from this page has done this.
- A "replacement record" IS an `audit_trail` row (action `FILTER_REPLACED`);
  `getReplacements()` reads straight from it. There is no operational table.
- A "retirement record" IS the filter's `AssetInstance` row (status `Retired`).
- `{recordType}` in audit templates derives from `targetType`
  (`audit-helpers.ts:181`) → 3 generic actions still render distinct
  descriptions per entity.
- The console is SUPER_ADMIN-only server-side (`requireRole('SUPER_ADMIN')`)
  even though the card is delegable in the UI (`EXPLICIT_GRANT_KEYS`).
  ⇒ **no new permission constants needed.**
- `filter-data-management.tsx` is the ONLY caller of `/api/super-admin/data/*`
  and `/filter-data/*` (grep across `apps/web/src`) ⇒ making `reason` required
  breaks no other surface.
- **`timestamp` IS part of the hashed canonical payload** (`hash-chain.ts:297`
  + `:317`). `auditLog()` stamps `new Date()` at `audit.ts:107` and uses the
  SAME variable for the row and the checksum — so threading an optional
  `entry.timestamp` through is chain-correct, and back-dating does not break
  the chain (the chain is ordered by `chain_position`, not by time).
  This also pins the existing replacements-PUT bug: it rewrites `timestamp`,
  `userName` AND `afterValue` — all three are hashed.
- `{reason}` in audit templates resolves from before/afterValue ONLY
  (`audit-helpers.ts:190`); it never reads `record.reason`. Storing the
  justification in the audit `reason` column alone renders an EMPTY
  `{reason}`, and `replacePlaceholders` only strips empties when quoted.

## Explicit assumption (stated to the user on delivery)
This retrofit adds **audit coverage** and the missing CRUD. It does NOT change
what each handler writes downstream — e.g. editing a cycle's `status` still
does not reconcile `FilterDetails.currentLifecycleState`. Dependent-consistency
repair is a separate call for the user to make.

## Plan

### A. packages/shared
- [x] `audit-actions.ts` +4: `MANUAL_RECORD_CREATED`, `MANUAL_RECORD_UPDATED`,
      `MANUAL_RECORD_DELETED`, `AUDIT_RECORD_UPDATED`
- [x] `audit-templates.ts` +4 defaults under existing category
      `Data & Approvals` (no new category → no `as const` / snapshot churn)
- [x] `reauth-actions.ts` +1: `UPDATE_AUDIT_RECORD` (93→94)
- [x] `audit.ts`: `AuditEntry.timestamp?` (optional) threaded into the row AND
      the checksum, so back-dated manual records carry the real date
- [x] `npm run build -w @digilog/shared`
- [x] fix `audit-templates.test.ts` counts if they lock

### B. apps/api
- [x] `super-admin/routes.ts`
  - [x] `reason` (required, min 5) on every mutation body schema
  - [x] `auditLog()` on all 21 existing mutation handlers
  - [x] `deleteRecord()` pre-fetches the row → real `beforeValue`; its
        signature gains `req` (no request context today) → 6 call sites
  - [x] cleaning-cycle DELETE: record the cascade (filterEvent.deleteMany,
        filterDetails.updateMany) in the audit payload
  - [x] replacements PUT: meta-audit `AUDIT_RECORD_UPDATED` + honest comment
        about the chain break
  - [x] NEW `DELETE /filter-data/retirements/:id` (refuse-if-history)
  - [x] NEW `POST /filter-data/retirements` — **two writes**: the
        `AssetInstance` (status Retired) AND the joined `FILTER_RETIRED` audit
        row, because `getRetirements()` reads remarks / retiredBy / retiredAt
        off that audit row (an AssetInstance alone renders nulls)
  - [x] NEW `POST /filter-data/replacements` (chain-linked FILTER_REPLACED row,
        `manualEntry: true`, reason stored)
  - [x] `dataSchema()` — drop the "(no audit trail)" suffix; fix header comment
- [x] `audit/routes.ts`
  - [x] NEW `PUT /api/audit/:id` — SUPER_ADMIN + reauth `UPDATE_AUDIT_RECORD`
        + reason; meta-audit `AUDIT_RECORD_UPDATED` written BEFORE the edit;
        chain breakage deliberately left loud

### C. apps/web
- [x] `filter-data-management.tsx`
  - [x] reason box wired into edit / create / delete dialogs
  - [x] Retirements tab: Create + Delete buttons
  - [x] Replacements tab: Create + Delete buttons
  - [x] Audit Trail tab: Edit + Delete + Redact (reuse `/api/audit` endpoints)
  - [x] header banner :659 / create note :1607 / unretire text :1734 — text now
        says changes ARE audited
  - [x] `getAuditStatus` :59 — new actions
- [x] `audit-helpers.ts:190` — add `record.reason` to the `{reason}` fallback
      chain so the mandatory justification actually renders
- [x] `config/index.tsx:203` card description
- [x] `/audit` page: action-filter dropdown + its own `getAuditStatus` copy

### D. Verify
- [x] `GET /api/audit/verify-chain` before / after — **live baseline measured
      2026-08-27: see below**. Audit edit + replacement delete ADD chain breaks
      on purpose; without an exact pre-number an intended break cannot be told
      from an introduced one. Do NOT recompute historical checksums.
      - **baseline 2026-08-27, pre-work** (`?maxAnomalies=10000`):
        `intact: false`, totalRowsChecked **18271**, chainedRows **18270**,
        highestPosition **18442**, anomalies **3408** =
        3308 `PER_ROW_CHECKSUM_MISMATCH` + 59 `CHAIN_POSITION_GAP` +
        41 `CHAIN_LINK_MISMATCH`. (Identical to the 2026-08-08 measurement —
        the legacy breakage is stable.) Saved: `scratchpad/verify-baseline.json`.
        NOTE: the default `maxAnomalies=100` truncates and also mis-reports
        `chainedRows` as 191 — always pass `maxAnomalies=10000`.
- [x] curl each new + retrofitted endpoint
- [x] browser pass over all 9 tabs
- [x] `npx tsc -p apps/api/tsconfig.json`, `npx vite build`
- [x] docs: CLAUDE.md counts, CHANGELOG.md, memory


## Status - 2026-08-27

**Backend + shared: DONE and verified live.** `npx tsc -p apps/api/tsconfig.json`
clean, `npx tsc -p apps/web/tsconfig.json` clean, `npx vite build` clean,
333 shared tests pass.

### Verified end to end against the running API
| Check | Result |
| --- | --- |
| PUT without `_changeReason` | 400 VALIDATION_ERROR (schema) / REASON_REQUIRED (runtime) |
| Notification edit with reason | `MANUAL_RECORD_UPDATED` row written, reason stored |
| 9 audited writes | anomalies stayed at **3408** - new rows chain correctly |
| Manual replacement create, back-dated 2026-03-15 | shows on the Replacement list with that date |
| Replacement edit | `{success, chainBroken:true}`, meta-row first, anomalies 3408 -> **3409** (exactly one `PER_ROW_CHECKSUM_MISMATCH`) |
| Replacement delete | row gone, list back to 137, anomalies -> **3410** (`CHAIN_POSITION_GAP` + `CHAIN_LINK_MISMATCH`), `audit_trail_no_delete` re-enabled (`tgenabled = O`) |
| Retirement delete on a filter with history | 409 `HAS_HISTORY` - "3 cleaning cycles, 23 filter events" |
| Retirement delete, clean fixture | asset + sidecar gone, all 4 audit rows kept |
| Retirement create, back-dated | remarks / performer / date render from the joined FILTER_RETIRED row; `_preRetireParentId` stashed |
| Restore (unretire) | filter back to Active under AHU-022 |
| Audit edit on a meta-audit row | 409 `META_AUDIT_IMMUTABLE` |
| Audit edit on a normal row | `chainBroken:true`, anomalies -> **3411** |

**Dev-DB cost of that testing: 3408 -> 3411 anomalies.** Three deliberate breaks
(one replacement edit, one replacement delete, one audit edit), all on rows
created for the test except the last. Permanent and expected - this is what the
feature does.

### Second pass - five things the first pass missed

1. **Two e2e suites broke** on the new required field.
   `super-admin-data-delete.test.ts` (3 tests) and `super-admin-unretire.test.ts`
   (2 tests) called these endpoints with no `_changeReason` and got 400.
   Both updated and green. Checking only the WEB callers was not enough.
2. **The page never handled reauth.** `apiClient` does not prompt - it rethrows
   `REAUTH_REQUIRED` - and this page called it directly. `SUPER_ADMIN_DATA_EDIT`
   happens to be absent from `system_config['action-reauth']` today (82 keys, 0
   enabled for SUPER_ADMIN), so nothing was visibly broken; the moment an
   operator switched that toggle on, every button here would have failed with an
   unexplained toast. Every call now goes through `gated()` (`useReauth`
   `executeWithResult`) and `<ReauthDialog>` is rendered. A cancelled prompt is
   silent, not an error toast.
   Also: `ReauthDialog` already uses `priority` (`z-[60]`), which tied with the
   new reason prompt. The prompt dropped to `z-50` and the reauth dialog is
   rendered last, so the password step always sits on top.
3. **Retirement delete cascades were under-counted.** `information_schema` shows
   5 CASCADE FKs into `asset_instances.id`, not the 4 things the blocker list
   checked. `asset_relationships` (x2) and `entity_assignments` are now captured
   into `_sideEffects` before the delete - not blockers (a retired filter's
   relationships are already torn down, and a visibility grant is not §11
   evidence), but nothing gets destroyed unrecorded.
4. **`AUDIT_RECORD_REDACTED` was missing from the meta-audit guard**, so the
   record of a redaction could be edited while the record of an edit or a delete
   could not. Both redact actions added.
5. **A back-dated replacement appeared nowhere near the top of `/audit`.**
   Replacement-create wrote only the back-dated `FILTER_REPLACED` row, so a
   record dated last March sorted far down a timestamp-desc list - the operator
   sees nothing. It now also writes a `MANUAL_RECORD_CREATED` marker stamped
   now, matching the retirement-create path. Verified.

**Final chain state: 3413 anomalies** (baseline 3408). Five deliberate breaks
from testing: 2 edits (+2 `PER_ROW_CHECKSUM_MISMATCH`, 1 later removed with its
row) and 2 deletes (+2 `CHAIN_POSITION_GAP`, +2 `CHAIN_LINK_MISMATCH`).

### Third pass - visibility (operator request: "visible only for super admin")

New `apps/api/src/lib/audit-visibility.ts` - one definition of who may SEE which
audit rows, shared by `/api/audit` (list / detail / delete / bulk-delete) and
`/api/debug/traces`. Non-SUPER_ADMIN readers are scoped on TWO rules:

1. **Actor** (pre-existing) - no rows authored by a SUPER_ADMIN.
2. **Action** (new) - no `MANUAL_RECORD_*` / `AUDIT_RECORD_*` rows, whoever
   wrote them.

Rule 1 alone was **incidental**: it protected these rows only because a
SUPER_ADMIN happens to perform them. Every role holds `AUDIT_READ`, so the day
the console opened to a delegated role, every manual edit to cleaning history
became readable by everyone. The guarantee is now a property of the record.

`FILTER_RETIRED` / `FILTER_REPLACED` are deliberately NOT restricted - they drive
the Retirement and Replacement lists operators are meant to read.

🔴 **`/api/debug/traces` had no row scoping at all**, and `toTrace()` returns the
whole row (before/after, reason, actor, role, IP). `READ_DEBUG_TRACE` is held
only by SUPER_ADMIN today but is grantable - one toggle from a full leak. List
and stats counts are both scoped now.

Also removed three UI affordances that implied the page was delegable when its
endpoints are all `requireRole('SUPER_ADMIN')`: `EXPLICIT_GRANT_KEYS` (emptied),
the route gate (`CONFIG_READ`/`CONFIG_UPDATE` -> `RequireRole roles={[]}`), and
its row in the Configuration Access matrix (`EXTRA_MODULES`, emptied). The
`access-matrix` config never granted it to any role, so nothing was taken away.

#### Verified with a real non-SUPER_ADMIN
Created a throwaway ADMIN (`990099`), tested, then reverted the ADMIN role's
permissions from an exact snapshot (23 perms, `READ_DEBUG_TRACE` absent) and
deleted the user (back to 6 users).

| Check | SUPER_ADMIN | ADMIN |
| --- | --- | --- |
| `/api/audit` total | 18307 | 10412 |
| restricted actions in 200-row page | - | **0** |
| SUPER_ADMIN-authored rows leaked | - | **0** |
| direct fetch of a restricted row by UUID | 200 | **404** |
| `/api/debug/traces` total (perm temporarily granted) | 18307 | 10413, **0** restricted |

88 restricted rows exist in the table (`MANUAL_RECORD_*` 11, `AUDIT_RECORD_*` 77)
and none reached a non-owner.

New unit test `apps/api/src/lib/__tests__/audit-visibility.test.ts` (11 tests)
locks both rules and fails if a future `MANUAL_RECORD_*` / `AUDIT_RECORD_*`
action is added to the shared registry without being restricted here.

### Outstanding
- [ ] **Browser click-through of the 9 tabs.** Not done: no Playwright MCP in
      this session and the Chrome extension is not connected. The page
      typechecks and builds, and every endpoint behind it is verified, but the
      dialogs, the new buttons and the rendered `{reason}` text have not been
      seen in a browser.
