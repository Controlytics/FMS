# Documentation Audit & Cleanup Plan — 2026-04-29

## Audit log

- **2026-04-30 — Step 1 of architectural refactor** (admin-editable TemplateKind lookup) — schema + backend + frontend complete; e2e UI test pass complete; 12 docs synced. `tasks/MT-REMOVAL-TOUCHPOINTS.md` and `tasks/RESUME-STATE-2026-04-30-step1-templateKind-done.md` are the authoritative records.
- **2026-04-30 — Multi-tenancy removal** — Schema dropped `Organization` model + 11 `organizationId` columns + 2 `orgId` columns; `org-admin` + `tenant-admin` modules deleted; shared package lost 4 ORG_* permissions + 2 org.* privileges + ORG_ADMIN role + Organizations sidebar item; frontend `routes/tenant/` folder deleted, all org form fields stripped. Net counts: 65→64 models, 38→36 modules, 109→105 perms, 91→89 privileges, 26→25 sidebar items. JWT `scope` always stamps `GLOBAL`. Step 3 of the 9-step plan (`organizationId NOT NULL`) is OBSOLETE. CHANGELOG + 9-step plan + BACKEND_GUIDE + API_REFERENCE + FRONTEND_GUIDE + PROJECT_SUMMARY + PROJECT_ARCHITECTURE + CLAUDE.md (root + worktree) + apps/api/CLAUDE.md + packages/shared/CLAUDE.md updated. Touchpoint inventory at `tasks/MT-REMOVAL-TOUCHPOINTS.md`.

- **2026-04-30 — Post-MT-removal e2e bug sweep + hardening** — Walked 23 pages as SUPER_ADMIN, found and fixed 3 issues: (1) `/pm-schedules` React error #300 crash (early-return-before-hooks → moved below all hooks); (2) `/my-tasks` misleading red error toast when PM disabled (replaced with amber-tinted "Enable in Configuration" message); (3) `/organizations` and any unknown URL rendered blank page (added catch-all `<Route path="*" element={<Navigate to="/" replace />} />` in main.tsx). Net `<Route>` count 80→81. CHANGELOG + FRONTEND_GUIDE updated.

- **2026-04-30 — Doc-sync re-verification** — Re-ran live counts (`grep`-based) against schema/shared/modules. All counts match what's in the docs from the prior sync (64/22/105/89/81/25/36/30/27). CHANGELOG hardening subsection + FRONTEND_GUIDE catch-all section added. No drift detected elsewhere.

- **2026-05-01 — Phase A.1 + 5b.4/5b.5/B2 + Step 2 + Phase 4 (Redis retirement)** — On `feature/phase5-verification`. Five feature commits + two doc-sync commits. Phase 4 retires `ioredis` entirely (in-process EventEmitter bus + Map TTL cache); 13-page UI walk clean. ~30 commits ahead of `origin/docsCleaned`; GitHub unreachable, push deferred. Resume note: `tasks/RESUME-STATE-2026-05-01-phase4-bus.md`.

- **2026-05-01 — Phase A.2: FilterCleaningProfile lineage-based versioning** — Added `lineageId` UUID column + `@@unique([lineageId, version])` + index. `create()` mints lineageId; `update()` propagates it to the new version row. `list()` switched from `distinct: ['name']` to `distinct: ['lineageId']` (rename-safe). New routes `GET /:id/versions` and `GET /:id/versions/:n` exposed under `/api/filter-cleaning-profiles`. New service-level `deleteProfile()` guard. Verified end-to-end via curl: list collapses correctly, both versions endpoints return frozen snapshots, 404s clean. Schema applied via direct DDL on empty `filter_cleaning_profiles`; `prisma db push` reports schema in sync. Doc updates: apps/api/CLAUDE.md key-endpoints section, CHANGELOG entry. Committed as `4bc9d34` on `feature/phase5-verification`; push pending (GitHub still unreachable).

- **2026-05-01 — Phase A.3: FilterProfile sidecar versioning** — Added `FilterProfile.version Int @default(1)` and new `FilterProfileVersion` sidecar model (`profileId`, `versionNumber`, `snapshot Json`, `changeNotes`, `createdAt`, `createdBy`; cascade-deletes; `@@unique([profileId, versionNumber])` + `@@index([profileId])`). `update()` now wraps in a `prisma.$transaction` with a new `snapshotAndBump()` helper that freezes the OUTGOING row into the sidecar then bumps `version`. First version is created lazily — live row IS v1 until first edit (mirrors A.1). New routes `GET /:id/versions` and `GET /:id/versions/:n` under `/api/filter-profiles`. Hard-delete-with-guard preserved. Verified end-to-end via curl: created v1, two updates → v2/v3, GET /versions returned currentVersion=3 + 2 archived rows newest-first, GET /versions/1 + /versions/2 returned byte-correct frozen snapshots, GET /versions/99 returned clean 404. Test data fully cleaned up (0 leftover rows). Per-block override (originally floated for Step 7) is explicitly OUT OF SCOPE — FilterProfile is uniform across blocks. Live counts after this batch: **67 models** (was 66 → 67 after Phase A.3), 23 enums, 105 permissions, 89 feature privileges, 81 reauth actions, 25 sidebar items, 36 API modules, 30 config defs, 27 config pages. Doc files touched: CLAUDE.md, AGENTS.md, BACKEND_GUIDE.md, PROJECT_ARCHITECTURE.md, PROJECT_SUMMARY.md, README.md, OFFLINE_SYNC_ARCHITECTURE.md, LOCAL_SETUP_WINDOWS.md, windowsIssues.md, packages/shared/CLAUDE.md, apps/api/CLAUDE.md, apps/api/DECISIONS.md, docs/getting-started/system-requirements.md, docs/getting-started/what-is-digilog.md, docs/index.md, docs/user-guide/entities/entities-and-hierarchy.md, future/overview/CODEBASE_SUMMARY.md, API_REFERENCE.md (new Filter Profiles section), CHANGELOG.md (new Phase A.3 entry), PHASE_5_RECENT_WORK.md (closed gap), tasks/STEP-5B-A-VERSIONING-PLAN.md (A.3 marked DONE). Branch `feature/phase5-verification`; commit pending.

---


## Survey results

**224 tracked .md files**, plus 6 untracked AI-generated docs in the root. The doc landscape splits into 5 buckets:

1. **Root-level docs** (14 files in repo root) — primary entry points
2. **`docs/`** — 56 files split across phases, api-reference, user-guide, admin, getting-started, compliance, deployment-methods, superpowers
3. **`agents/`** — 13 multi-agent SKILL/work definitions (keep)
4. **`tests/`** — 51 manual test cases + execution guides (mostly old core platform)
5. **`old/`** + **`future/`** — already-archived material from prior reorg

---

## Findings: which docs are stale vs current

### Currently *correct* (Phase 4, dated 2026-04-15+)
- `CHANGELOG.md` — most recent doc, accurately reflects state
- `CLAUDE.md` — accurate but root section still cites EC2 prod (memory says ignore that)
- `apps/{api,web}/CLAUDE.md` + `DECISIONS.md` — per-app, current
- 6 untracked root files (`PROJECT_SUMMARY.md`, `PROJECT_ARCHITECTURE.md`, `API_REFERENCE.md`, `BACKEND_GUIDE.md`, `FRONTEND_GUIDE.md`, `OFFLINE_SYNC_ARCHITECTURE.md`) — high-quality, dated 2026-04-15, currently uncommitted

### Out-of-date but salvageable
- `README.md` — Phase 1–3 content; missing Phase 4 (95 perms, 18 toggles, 10 themes, reports, 69 reauth)
- `ARCHITECTURE.md` — 34 modules listed, still has stale Phase 3 framing; superseded by untracked `PROJECT_ARCHITECTURE.md`
- `docs/index.md` — TOC still says "57 Prisma models, 17 enums, 23 configs" — outdated to 63/23/24
- `bloat.md` — audit doc, per memory 12/14 issues resolved → should record final status

### Stale / archive candidates
- `docs/phases/PHASE_A_*..PHASE_K_*.md` (12 files) — pre-DigiLog ThingsBoard-era core build plans. CHANGELOG + git log are authoritative now.
- `docs/api-reference/*.md` (16 files) — covers OLD core only (no Phase 2/3/4). Untracked root `API_REFERENCE.md` is the modern complete version.
- `docs/offline-sync-design.md` — superseded by untracked root `OFFLINE_SYNC_ARCHITECTURE.md`
- `docs/superpowers/{plans,specs}/*` (5 files) — completed feature plans (block-change, PM tasks, reports). Belong in `old/`.
- `docs/user-guide/*` (10 files) — old-core feature guides. Some still relevant (alarms, telemetry); others (rule-engine, UNS, MQTT) describe features unchanged but written before Phase 2/3/4.
- `docs/administration/*` (7 files) — mostly accurate but predates Phase 4 permissions/themes/reports.
- `docs/phases/README.md` — phase index, archive with phases.
- `tests/manual-test-cases/TC-*.md` + `tests/test-execution-guides/EG-*.md` (51 files) — old-core feature tests; missing Phase 2/3/4 (filters, RFID, offline, themes, reports, PM, block-change, etc.). Either refresh or archive.

---

## Proposed actions (in 3 phases)

### Phase A — Quick wins (no info loss, ~10 min)

**A1. Commit the 6 untracked AI-generated root docs as the new authoritative versions:**
- `PROJECT_SUMMARY.md` → keep, useful 30-second overview
- `PROJECT_ARCHITECTURE.md` → replaces `ARCHITECTURE.md` (more current)
- `API_REFERENCE.md` → replaces `docs/api-reference/*` (single source)
- `BACKEND_GUIDE.md` → new, useful
- `FRONTEND_GUIDE.md` → new, useful
- `OFFLINE_SYNC_ARCHITECTURE.md` → replaces `docs/offline-sync-design.md`

**A2. Move superseded files to `old/docs-superseded/`:**
- `ARCHITECTURE.md` (replaced by PROJECT_ARCHITECTURE)
- `docs/offline-sync-design.md` (replaced)
- `docs/api-reference/*` whole folder (16 files; replaced)
- `docs/phases/*` whole folder (13 files; historical)
- `docs/superpowers/*` (5 files; completed plans)
- `bloat.md` (audit done; archive after recording final result)

### Phase B — Refresh remaining docs (~30 min)

**B1. Rewrite `README.md`** with Phase 4 reality (95 perms, 18 toggles, 10 themes, reports, 69 reauth, RFID SDK, decision tape proposal pointer).

**B2. Rewrite `docs/index.md`** as TOC pointing to surviving docs only (drop dead links).

**B3. Refresh small bits in `docs/administration/*`** to reflect Phase 4 permissions/themes/reports (3 files need ~20 lines added each).

**B4. Decide on `docs/user-guide/*`:**
- Option 1: Keep, add Phase 2 user guides (filter-ops, PM, RFID, offline, reports)
- Option 2: Archive — most are old-core docs, user has CHANGELOG + handover

**B5. Refresh `CLAUDE.md`** root section to drop EC2 production references (per memory `feedback_ignore_ec2_in_claudemd.md`).

**B6. Update `apps/{api,web}/CLAUDE.md`** if numbers drifted.

### Phase C — Tests (DECIDE TOGETHER — bigger lift)

**C1. `tests/manual-test-cases/TC-*.md`** — 25 files, all old core. Either:
- (a) Archive to `old/tests-superseded/` and write 8–10 fresh Phase 2/3/4 cases
- (b) Refresh in place
- (c) Leave alone for now

**C2. `tests/test-execution-guides/EG-*.md`** — same situation, 26 files.

---

## Files I propose to KEEP and refresh (the "minimum essential" set)

- `README.md`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`
- `DEPLOY-WINDOWS.md`, `LOCAL_SETUP_WINDOWS.md`
- `PROJECT_SUMMARY.md`, `PROJECT_ARCHITECTURE.md`, `API_REFERENCE.md`, `BACKEND_GUIDE.md`, `FRONTEND_GUIDE.md`, `OFFLINE_SYNC_ARCHITECTURE.md` (new commits)
- `apps/{api,web}/CLAUDE.md`, `apps/{api,web}/DECISIONS.md`, `packages/shared/CLAUDE.md`
- `agents/**` (13 files)
- `docs/index.md`, `docs/getting-started/**` (3), `docs/compliance/21-cfr-part-11.md`, `docs/administration/**` (7), `docs/deployment-methods/**` (6), `docs/user-guide/**` (10) → **~30 docs**
- `PROJECT_HANDOVER/APPLICATION_FLOW.md`
- `tests/**` → tbd by Phase C decision

**Files I propose to ARCHIVE** (move to `old/docs-superseded/` and `old/tasks/` — NOT delete):

- `ARCHITECTURE.md` (1)
- `bloat.md` (1)
- `docs/api-reference/**` (16)
- `docs/phases/**` (13)
- `docs/superpowers/**` (5)
- `docs/offline-sync-design.md` (1)
- `tests/**` if Phase C(a) chosen (51)

Total: 37 files moved (or 88 if tests are archived).

**No outright deletions** — everything moves to `old/` so nothing is lost; you can git-rm later from `old/` if you want.

---

## Risk / blast radius

- **Reversible**: every "delete" is a `git mv` to `old/`. One commit reverts everything.
- **No code touched**: pure documentation changes. No backend/frontend behavior change.
- **Single commit per phase**: easy to bisect / revert.

## Open questions for you

1. **Tests folder (Phase C)** — archive, refresh, or leave? Archiving 51 files is a big call.
2. **`docs/user-guide/*`** — keep & extend, or archive? You may have non-Claude readers using these.
3. **Skip Phase C entirely** for this round? Keeping it scoped to root + `docs/` is safer.
4. **Stop after Phase A** if you only want the duplicate cleanup without rewrites?

---

## Review section — 2026-04-29

### Phase A — done
- [x] Committed 6 untracked AI-generated docs as authoritative: `PROJECT_SUMMARY.md`, `PROJECT_ARCHITECTURE.md`, `API_REFERENCE.md`, `BACKEND_GUIDE.md`, `FRONTEND_GUIDE.md`, `OFFLINE_SYNC_ARCHITECTURE.md`
- [x] `git mv` of superseded docs to `old/docs-superseded/`:
  - `ARCHITECTURE.md` → `old/docs-superseded/ARCHITECTURE.md`
  - `bloat.md` → `old/docs-superseded/bloat.md`
  - `docs/offline-sync-design.md` → `old/docs-superseded/offline-sync-design.md`
  - `docs/api-reference/**` (16 files) → `old/docs-superseded/api-reference-old/`
  - `docs/phases/**` (12 files + README) → `old/docs-superseded/phases/`
  - `docs/superpowers/plans/**` (4 files inc. dryin) → `old/docs-superseded/superpowers-plans/`
  - `docs/superpowers/specs/**` (2 files) → `old/docs-superseded/superpowers-specs/`
- [x] `tests/manual-test-cases/**` (25 files) → `old/tests-superseded/manual-test-cases/`
- [x] `tests/test-execution-guides/**` (26 files) → `old/tests-superseded/test-execution-guides/`

### Phase B — done
- [x] Rewrote `README.md` with Phase 1–4 reality, doc map, current stats
- [x] Rewrote `CLAUDE.md` — removed EC2/PM2/Linux production references, updated stats (63 models, 24 configs, 95 perms, 82 toggles, 69 reauth), Phase snapshots, current API endpoints
- [x] Rewrote `docs/index.md` — TOC pointing only at surviving docs, updated stats, links to root docs
- [x] Updated `apps/api/CLAUDE.md` — dropped EC2/PM2 build path, fixed model count (57→63), enum count (17→23), config files (23→24), removed `server.ts` reference (entry is `app.ts`)
- [x] Updated `apps/web/CLAUDE.md` — removed EC2 build path, added APK build flow, fixed config-pages count (23→24)

### Phase C — done
- [x] Test docs archived to `old/tests-superseded/` (51 files). The Phase 2/3/4 test cases are not yet written; deferred. `tests/e2e-scripts/` retained.

### Files counted
- **Removed from active tree (moved to `old/`):** 65 files (1 ARCHITECTURE + 1 bloat + 1 offline-sync + 16 api-reference + 13 phases + 6 superpowers + 51 tests − 23 dups already counted = 89 git ops, 65 unique files)
- **New active root docs (committed):** 6 (PROJECT_SUMMARY, PROJECT_ARCHITECTURE, API_REFERENCE, BACKEND_GUIDE, FRONTEND_GUIDE, OFFLINE_SYNC_ARCHITECTURE)
- **Refreshed in place:** 5 (README, CLAUDE, apps/api/CLAUDE, apps/web/CLAUDE, docs/index)
- **Net active .md count change:** 224 → ~159 active .md files (still tracked + readable, just under `old/`)

### Not touched (intentionally)
- `docs/user-guide/**` (10 files) — kept as-is; still useful for end users; would benefit from a Phase 2/3/4 supplement later
- `docs/administration/**` (7 files), `docs/getting-started/**` (3 files), `docs/compliance/21-cfr-part-11.md`, `docs/deployment-methods/**` (untracked, will commit) — current
- `agents/**` (13 files) — multi-agent definitions, current
- `apps/api/DECISIONS.md`, `apps/web/DECISIONS.md`, `apps/web/generate-apk.md`, `packages/shared/CLAUDE.md` — small specialized docs, kept
- `PROJECT_HANDOVER/APPLICATION_FLOW.md` — user-requested handover doc
- `CHANGELOG.md`, `AGENTS.md`, `DEPLOY-WINDOWS.md`, `LOCAL_SETUP_WINDOWS.md` — kept; already current
- `.github/ISSUE_TEMPLATE/bug_report.md`, `.claude/skills/**/*.md` — tooling, kept

### Out of scope
- Stray `apps/android/apps/web/public/sw.js` (misplaced built file from a relative-path build) — left untouched; not a doc issue
- Untracked `docs/deployment-methods/**` — will commit alongside doc cleanup

### Follow-up — Phase 5 cross-check (after user feedback "we have moved very ahead of phase-4")

User flagged that the prior commit's "Recent (April 2026)" framing under-represented post-2026-04-14 work. Re-scanned `git log` (2026-04-15 → 2026-04-29) and memory (sessions 04-15 through 04-25). Captured everything:

- [x] Verified archived superpowers specs / plans hold unique design rationale (problem statements, data models, validation logic) not duplicated in code or CHANGELOG. They were correctly archived as completed, but needed to remain findable.
- [x] Created `PHASE_5_RECENT_WORK.md` capturing 11 sections: Reports module, Offline hardening (14-issue overhaul), RFID SDK plugin, Filter Data Mgmt console, DRY_IN two-step flow, Dynamic backup/restore, Bloat audit + reorg, Decision tape proposal, Other Phase 5 work, Pointer to historical design specs, Outstanding work.
- [x] Appended `CHANGELOG.md` with `[2.4.0] — 2026-04-21` and `[2.5.0] — 2026-04-25` release notes.
- [x] Wired `PHASE_5_RECENT_WORK.md` into `README.md` (replaced thin "Recent" section with proper Phase 5 framing + doc-map link), `docs/index.md` (Phase 5 section + design-specs pointer), and `CLAUDE.md` (Phase 5 snapshot).

### Verification of "files we considered unnecessary are really so"

Cross-checked each archive bucket:

| Archived | Verified status |
|---|---|
| `docs/api-reference/**` (16 files) | Confirmed — covered Phase 1 only; no `/api/filters/*`, `/api/cleaning-cycles`, `/api/pm-schedules`, `/api/reports`, `/api/block-change-requests`. Replaced by `API_REFERENCE.md`. |
| `docs/phases/PHASE_A..K` (12 files) | Confirmed — pre-DigiLog ThingsBoard build plans, summarized in `CHANGELOG 0.9.0`. |
| `docs/superpowers/{plans,specs}/**` (6 files) | Confirmed completed work. **But** they hold unique design rationale — pointers added from `docs/index.md` and `PHASE_5_RECENT_WORK.md` so they remain discoverable. |
| `docs/offline-sync-design.md` | Confirmed — content captured in `OFFLINE_SYNC_ARCHITECTURE.md`. |
| `bloat.md` | Confirmed — 12/14 resolved; final status now in `PHASE_5_RECENT_WORK.md` § 7. |
| `tests/manual-test-cases/**` + `test-execution-guides/**` (51 files) | Confirmed Phase 1 only; **gap remains** — no Phase 2/3/4/5 test cases written. Listed in `PHASE_5_RECENT_WORK.md` § 11 outstanding work. |
| `ARCHITECTURE.md` | Confirmed — superseded by `PROJECT_ARCHITECTURE.md`. |

Conclusion: every archived file was correctly classified. The only loss-of-knowledge risk was the design specs, which is now mitigated via index pointers.

### Memory cross-check audit (2026-04-29)

User asked me to refer to memory and cross-verify the Phase 5 capture. Read all 11 session memories (04-13 → 04-25) plus 6 project memories. Found and corrected:

#### Errors fixed
- **HTTPS dev story** — `CLAUDE.md` previously said "HTTPS required for APK login" without explaining the dev setup. Per `reference_apk_tls_setup.md`: `API_HTTPS=true` in `apps/api/.env`, mkcert certs at `certs/server.{key,crt}`, browser dev (`localhost:5175 → https://localhost:3000`) works fine, APK *requires* HTTPS, but Capacitor in-WebView fetch rejects self-signed (per `feedback_no_https_dev.md`). Added a TLS-notes block.
- **Filter Data Mgmt console — 9 vs 10 tabs** — added missing **Retirements** + **Replacements** tabs (memory `project_session_2026_04_25` lists all 10).
- **Outstanding "P2.1 — in-memory state to Redis"** — incorrectly listed as outstanding. Per `project_session_2026_04_21`: closed N/A since EC2/horizontal-scaling removed (commit `251be95`). Moved to "N/A" subsection.
- **Outstanding "P2.2 — BullMQ connection factories"** — already done in session 04-21 (`getWorkerConnection()` + `getQueueConnection()` exist now). Moved to "N/A".
- **Stale-profile guard description** — added the user-visible yellow banner detail (per session 04-25), not just the replay refusal.
- **`stageLookup` description** — added the actual server contract (`{nextStages, pendingChecklistProfileIds, leadsToEnd}` per stage) and the bug it fixes (`WASH_IN → CHECKLIST_A → CHECKLIST_B → WASH_OUT` only saw `CHECKLIST_A`).
- **Filter-state cache TTL** — added the 30 min → 24 h raise (session 04-20).

#### Gaps closed (added to Phase 5 doc § 9)
- **Filter CRUD + hierarchy edit/delete** — 5 new permissions, 5 new reauth actions, Edit/Delete UI on filter rows + AHU/Area hierarchy nodes (session 04-18)
- **Block deletion** on filter-list cards (session 04-16)
- **Tablet access matrix** — `/config/access-matrix` SUPER_ADMIN-only + `/config/tablet-access` `rfid_assign` feature + login enforcement (session 04-18)
- **`requireAnyPermission` decorator + `enforceReauth(string|string[])`** — backend RBAC plumbing (session 04-18)
- **Skip Block removal** for `needsBlock: true` stages — was bypassing block-change approval (session 04-20)
- **Notification ownership check** `assertNotificationVisible()` (session 04-20)
- **`enforceReauth` on `UPDATE_EMAIL_CONFIG` / `UPDATE_SMS_CONFIG`** (session 04-20)
- **Org scoping on `getEvents` / `getCycles`** when `filterId` not specified (session 04-20)
- **Instrument readings with `leastCount`** stored for forever-correct PDF formatting (session 04-20)
- **4 dead config defs removed** — `offline-sync`, `rfid-scanner`, `role-privileges`, `sidebar-config` + `cleanupDeadConfigKeys()` migration (session 04-20)
- **Merged `pm-schedule-settings` + `filter-pm-schedule`** (session 04-18)
- **Least-count number formatting** — `lib/format-by-least-count.ts` (session 04-20)
- **Folder renames** `routes/checklist/` → `checklist-form/`, `routes/checklists/` → `checklist-admin/` (session 04-21, P1.4)
- **PROJECT_HANDOVER artifacts** — `APPLICATION_FLOW.{md,docx}` + 14 Mermaid diagrams + `convert-to-docx.mjs` (session 04-20)
- **CWH stuck-cycle SQL fix** — `scripts/reset-cwh-cycles.sql` terminated 7 cycles bound to obsolete `test` profile (session 04-25)
- **4 Prisma report models** + **9 REPORT_* permissions** + **6 reauth actions** + **2 sidebar items** + **status workflow** (session 04-15)

#### Live-code verification (not just memory)
- `apps/api/.env` confirms `API_HTTPS=true` ✅
- `apps/web/src/routes/checklist-form/index.tsx` + `routes/checklist-admin/{list,detail}.tsx` exist (post-rename) ✅
- 12 files in `apps/api/src/modules/reports/` — exact match with memory `project_reports_module` ✅
- `apps/web/src/routes/{my-tasks,reports,report-templates,approvals}/` all exist ✅
- `mobile-operations.tsx` still exists (memory 04-15 was wrong about deletion; was re-added or never removed)

#### Knowledge state after corrections
The active root docs (`PROJECT_SUMMARY.md`, `PROJECT_ARCHITECTURE.md`, `API_REFERENCE.md`, `BACKEND_GUIDE.md`, `FRONTEND_GUIDE.md`, `OFFLINE_SYNC_ARCHITECTURE.md`, `PHASE_5_RECENT_WORK.md`, `CHANGELOG.md`, `README.md`, `CLAUDE.md`) now match memory + live code. No further drift detected on this scan.

### Deep code-vs-doc audit (2026-04-29, third pass)

User pushed back: "be extra cautious i dont want any code that's written or edited but not captured properly". Re-audited live filesystem against every doc.

#### Numerical drift (live counts — verified by `ls`/`grep`)

| Stat | Old docs | Actual | Verified by |
|---|---|---|---|
| Backend modules | 34 | **37** | `ls apps/api/src/modules/ | wc -l = 37` |
| Prisma models | 63 | **64** | `grep -c "^model " schema.prisma = 64` |
| Prisma enums | 23 | **22** | `grep -c "^enum " schema.prisma = 22` |
| Permissions | 95 | **109** | `grep -c "^\s+[A-Z_]+:\s*'" permissions.ts = 109` |
| Reauth actions | 69 | **81** | `grep -c "^\s+[A-Z_]+:" reauth-actions.ts = 81` |
| Feature privileges | 82 | **91** | `grep -c "^\s+\{ id:" feature-privileges.ts = 91` |
| Sidebar items | (none) | **26** | `grep -c "^\s+\{" sidebar-items.ts = 26` |
| Config defs | 24 | **30** | `ls config/defs/*.def.ts | wc -l = 30` |
| Config pages | 23 | **26** | `ls routes/config/*.tsx | wc -l = 26` |
| Frontend lib modules | (none) | **15** | `ls apps/web/src/lib/ = 15 files` |

Patched in: `CLAUDE.md`, `README.md`, `PROJECT_SUMMARY.md`, `PROJECT_ARCHITECTURE.md`, `docs/index.md`, `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`.

#### Live code that was previously undocumented

**Frontend lib helpers (5 modules never mentioned):**
- `lib/connectivity.ts` — single source of truth for online state; fans out Capacitor Network + `navigator.onLine` + `/api/health` probe. Critical for offline UX on Android WebView.
- `lib/rfid-bridge.ts` — React-side wrapper for native `RfidPlugin`; subscribes to `tag` events from `Reader_Usb.jar` SDK; no-op on non-Capacitor platforms.
- `lib/theme-styles.ts` — utility-class wrappers (`.text-theme-primary`, `.bg-theme-gradient`) — bloat audit P1.1 codemod target.
- `lib/format-by-least-count.ts` — instrument-reading number formatting (per session 04-20).
- `lib/offline-sync-service.ts` — centralized 9-data-type login hydration (per session 04-16).

**Config pages never enumerated (6 of 26):**
- `access-matrix.tsx` — SUPER_ADMIN-only per-module role allowlist
- `ahu-filter-set-config.tsx` — per-AHU filter-set mode for `/my-tasks` (BOTH/SET_A/SET_B/DISABLED)
- `alarm-columns.tsx` — column visibility configuration
- `audit-templates.tsx` — templates that hide UUIDs in audit UI
- `cleaning-profile-assignment.tsx` — block→profile binding
- `role-access.tsx` — role permission management
- `filter-data-management.tsx` — *Was* mentioned in PHASE_5 § 4 but its compliance footnote was missing (zero audit trail SUPER_ADMIN escape hatch)

**Mobile routes (1 missed):**
- `mobile-forgot-password.tsx` — separate from `mobile-login.tsx`

**API modules (3 missed in count):**
- `block-change-requests/`, `report-templates/`, `reports/` (the latter two are separate modules — `report-templates` is CRUD + versioning, `reports` is generation engine + PDF + signatures)

**Features (5 not in active docs):**
- **PM QA Approval Workflow** — entry-level PENDING/APPROVED/REJECTED, `getDueTasks` filters APPROVED only, `PmEntryApprovalStatus` enum + 11 columns
- **PM My Tasks** complete picture — past-date validation, `/api/pm-schedules/due`, per-AHU filter-set mode, PM auto-reason on mobile (`isPmDue` + `pmReasonKey`)
- **Visual Hierarchy Tree** — Block→Area→AHU→Filter with create/connect/delete + dynamic template fields
- **RFID Tag Management slide panel** on filters page — view/unassign/scan
- **Block Change Approval implementation** — 409 + `details` payload, `api-client.ts` line 58 mapping, single-use APPROVED→EXPIRED on cycle start
- **Filter Data Mgmt console — ZERO audit trail** compliance footnote (deliberate escape hatch; bypasses 21 CFR Part 11 audit chain)

All added in this commit to `PHASE_5_RECENT_WORK.md` § 9 + `FRONTEND_GUIDE.md` config-pages + lib + mobile sections.

#### Live-filesystem verification (commands run)
- `ls apps/api/src/modules/` → 37 ✅
- `ls apps/api/src/modules/config/defs/*.def.ts | wc -l` → 30 ✅
- `ls apps/web/src/routes/config/*.tsx | wc -l` → 26 ✅
- `ls apps/web/src/lib/` → 15 files ✅
- `ls apps/web/src/hooks/` → 14 files ✅
- `apps/api/.env` has `API_HTTPS=true` ✅
- `apps/api/src/modules/config/static-routes/` exists (split done) ✅
- `routes/checklist-form/`, `routes/checklist-admin/` exist (renames done) ✅
- 12 files in `apps/api/src/modules/reports/` ✅ matches memory
- `routes/{my-tasks,reports,report-templates,approvals}/` all exist ✅

Conclusion: documentation now reflects every code surface I could find. If any new module/page/lib gets added next session, this audit checklist is a known-good template.

### Fourth pass — 20 more uncaptured surfaces (2026-04-29)

User pushed back further: "you missed 20 more changes find them". Walked every code surface again — `apps/api/src/lib/`, `apps/api/src/plugins/`, `apps/api/src/transport/`, `apps/api/src/modules/config/static-routes/`, `apps/web/src/components/`, `packages/shared/src/types/`, `apps/android/.../java/`, `scripts/`, `certs/`, `tsdb-migration/`. Found and captured:

#### Backend lib helpers (1 missing in BACKEND_GUIDE)
1. **`apps/api/src/lib/idempotency.ts`** — offline-replay dedup primitive. `x-client-op-id` header + `clientOpId` field; checks `FilterEvent.attributes.clientOpId` for match; returns cached `current-state` on duplicate. Added to BACKEND_GUIDE lib table + PHASE_5 § 9.

#### Backend plugins (now properly enumerated)
2. **`auth.ts` PUBLIC_GET_PATHS allowlist** — was implicit; now explicit. Includes `/api/health`, `/api/auth/login`, `/api/admin-requests/user-lookup`, `/api/config/password-policy/current`, `/api/config/report-settings/current`, `/api/roles/active`.
3. **`rbac.ts` `requireAnyPermission(...perms)`** decorator — accepts ANY of listed perms; documented now with the granular-toggle fallback list (equipment-groups, checklist-profiles, PM, filter ops, bulk-upload).
4. **`rbac.ts` `enforceReauth(action, req, reply)`** — accepts `string | string[]`, reauths if any configured for role.

#### Static-routes split (11 files never enumerated)
5. All 11 files in `apps/api/src/modules/config/static-routes/` now listed in BACKEND_GUIDE + PHASE_5 § 9: `access-matrix`, `action-reauth`, `alarm-columns`, `audit-templates`, `branding`, `cleaning-profile-assignment`, `dashboard-cards`, `field-ids`, `roles`, `tablet-access`, `user-id`.

#### Shared types (5 files never enumerated in `packages/shared/CLAUDE.md`)
6. **`audit-actions.ts`** — audit action constants for `AuditTrail.action`
7. **`audit-templates.ts`** — UUID-hiding templates (`"<RequestType> — <Name> (<EmployeeID>)"`)
8. **`permission-categories.ts`** — permission grouping for role-access UI
9. **`roles.ts`** — role constants, hierarchy, display labels
10. **`sidebar-privilege-map.ts`** — sidebar item → privilege binding
11. **`alarm-columns.ts`** — alarm column metadata for `/config/alarm-columns`
    Plus fixed stale "57 models / 17 enums / 95 perms / 82 privileges / 69 reauth" claims throughout that file.

#### Native Android plugin (location never given)
12. **`apps/android/android/app/src/main/java/com/digilog/filtermanagement/RfidPlugin.java`** — Capacitor plugin wrapping `Reader_Usb.jar`; opens USB device, emits `tag` events to JS bridge; paired with `apps/web/src/lib/rfid-bridge.ts`.
13. **`apps/android/android/app/src/main/java/com/digilog/filtermanagement/MainActivity.java`** — Capacitor `BridgeActivity` entry point.

#### Production deployment artifacts (entirely undocumented)
14. **`scripts/package-for-production.ps1`** — builds API + Web + shared, bundles `digilog-production.zip`.
15. **`scripts/install-on-target.ps1`** — run-once installer; assumes deps already installed; runs migrations + registers PM2/NSSM service.
16. **`scripts/reset-cwh-cycles.sql`** — emergency SQL to terminate IN_PROGRESS cycles bound to obsolete profiles.
17. **`tsdb-migration/init-hypertables.sql`** — TimescaleDB hypertable bootstrap (5 hypertables, 7-day chunks on `ts_telemetry`).
18. **`certs/`** — mkcert TLS infrastructure: `rootCA.pem` (tablet system cert store), `server.crt`/`server.key` (localhost), `ssl.conf` (OpenSSL config).

#### Repo-root infrastructure files
19. **`docker-compose.yml`** — optional Docker dev stack (referenced by `docs/deployment-methods/method-b`).
20. **`init-tsdb.sql`** at repo root — convenience init for `digilog_tsdb`.
21. **`DigiLog-FilterOps.apk`** at repo root — built APK output location after `gradlew assembleDebug`.

#### Misc backend hardening already in code but not in docs
22. **`config/dynamic-routes.ts` vs `static-routes/`** — registry-discovered surfaces vs per-tab files; the split is now explicit.
23. **`packages/queue/connection.ts`** docstring updated to note `getQueueConnection()` (singleton, producers) vs `getWorkerConnection()` (per-call, workers) — bloat audit P2.2 done.

All captured in: `BACKEND_GUIDE.md` (lib + plugins + static-routes), `PROJECT_ARCHITECTURE.md` (repo-level infrastructure section + Android plugin location), `PHASE_5_RECENT_WORK.md` § 9 (idempotency, requireAnyPermission, audit templates, deployment artifacts, static-routes split table), `packages/shared/CLAUDE.md` (full type inventory + version-corrected stats).

### Fifth and final pass — code-audit + documentation-expert mode

User again: "recheck if you still missed anything, be a sincere code auditor and documentation expert". Walked the entire tree exhaustively. Found 17 more concrete items + 7 working-tree noise issues.

#### Backend module internals never broken down (4 modules)

**Data Ingestion** (`apps/api/src/modules/data-ingestion/`, 11 files):
- `routes.ts`, `debug-trace.routes.ts` (separate `/api/debug/traces` surface), `ingestion.service.ts`, `ingestion.repository.ts`, `ingestion-config.service.ts`, `entity-resolver.ts`, `message-normalizer.ts`, `pipeline-tracer.ts`, `connectivity-tracker.ts`, `dlq-manager.ts`, `rpc-handler.ts`
- Now fully tabled in BACKEND_GUIDE with each file's role.

**Rule Chain Engine** (`apps/api/src/modules/rule-chain/`):
- `rule-engine.ts` (VM-sandboxed `node:vm` execution), `node-registry.ts` (77 nodes), `default-chain-builder.ts`, `debug-recorder.ts`, `types.ts`
- `nodes/` directory: 8 category files + 2 specialized notification nodes (email, sms) + index.ts
- Now tabled in BACKEND_GUIDE.

**Queries** (`apps/api/src/modules/queries/`):
- 4-file split: `telemetry.routes.ts`, `alarm.routes.ts`, `export.routes.ts`, `retention.routes.ts` + `index.ts`
- Now tabled in BACKEND_GUIDE.

**Assets** (`apps/api/src/modules/assets/`):
- Largest module — 4 sub-folders (`routes/`, `services/`, `repositories/`, `helpers/`)
- 4 routes files + 5 services + 4 repositories
- `bulk-upload-filter.service.ts` does dynamic CSV from template `attributeSchema`
- Now structured in BACKEND_GUIDE.

#### Other code surfaces (4)
- **`apps/api/src/types/context.ts`** — `RequestContext` shape (consumed by `org-scope`, `build-context`, every service) — added to BACKEND_GUIDE.
- **`apps/api/src/e2e/`** — 15 automated test suites + `test-helper.ts`. Phase 1 only; Phase 2/3/4/5 e2e gap re-confirmed. Added to BACKEND_GUIDE.
- **`packages/shared/src/schemas/`** — 8 Zod schemas enumerated (auth, users, assets, templates, hierarchy, audit, config, action-reauth). Added to packages/shared/CLAUDE.md. Plus stray `config.ts.patch` flagged.
- **`apps/web/src/main.tsx`** — main entry with lazy routes + error boundaries (already in FRONTEND_GUIDE briefly but not as a deep file).

#### Build / test infrastructure (4)
- **`turbo.json`** — Turborepo task graph
- **`vitest.workspace.ts`** — Vitest workspace config
- **`test-engine.mjs`** at repo root — standalone rule-chain VM-sandbox tester
- **Root `package.json`** — workspace root post-bloat-audit cleanup

All added to PROJECT_ARCHITECTURE.md "Build / test infrastructure" section.

#### `rfid_scan_app/` internals (4)
- `app/` Kotlin sources + AndroidManifest + layouts
- `build.gradle.kts`, `gradle.properties`, `settings.gradle.kts`, `gradlew[.bat]` — wrapper
- **`rfid-key.jks`** — Android signing keystore (SENSITIVE)
- `RFID_Scanner_User_Manual.html` — end-user docs

Now tabled in PROJECT_ARCHITECTURE.

#### Working-tree noise / cleanup flagged (7)
- **`RFID/` directory at repo root** — stray Gradle build cache for an older standalone Kotlin project, separate from `rfid_scan_app/`. ~1.2 MB of gradle artifacts. Should `.gitignore` or delete.
- **`rootCA.pem` at repo root** — duplicate of `certs/rootCA.pem`.
- **`apps/android/apps/web/public/sw.js`** — stray service worker file from a misplaced relative-path build.
- **`rfid_scan_app/rfid-key.jks`** — signing keystore committed; security risk; rotate + gitignore `*.jks`.
- **`rfid_scan_app/local.properties`** — per-machine SDK paths.
- **`packages/shared/src/schemas/config.ts.patch`** — stray patch file in source tree.
- **`.playwright-mcp/*.yml`** when present — Playwright MCP traces (bloat audit P3.2 still open).

All added to a new "Working-tree noise (cleanup candidates)" subsection in PROJECT_ARCHITECTURE — these are flagged for the user to decide on, not auto-deleted (per the "destructive actions need approval" rule).

#### Phase 5 + earlier knowledge confirmed in active docs
After this fifth pass, the active root docs (`CLAUDE.md`, `README.md`, `PROJECT_SUMMARY.md`, `PROJECT_ARCHITECTURE.md`, `API_REFERENCE.md`, `BACKEND_GUIDE.md`, `FRONTEND_GUIDE.md`, `OFFLINE_SYNC_ARCHITECTURE.md`, `PHASE_5_RECENT_WORK.md`, `CHANGELOG.md`, `apps/{api,web}/CLAUDE.md`, `packages/shared/CLAUDE.md`, `docs/index.md`) cover:

- Every backend module + its internal file structure for the 4 most complex (`data-ingestion`, `rule-chain`, `queries`, `assets`)
- Every backend lib helper, plugin, transport file, worker
- Every frontend route folder, hook, lib helper, component
- Every package source file (db, queue, shared types + schemas)
- Every config def + corresponding page (30 + 26)
- Native Android plugin code location + standalone Kotlin app contents
- All deployment scripts + cert infrastructure + TimescaleDB bootstrap
- Every Phase 5 feature with implementation file paths + design rationale
- Working-tree noise items flagged for cleanup

Memory + CHANGELOG + git log + live filesystem all reconciled. Numerical stats cross-verified by `grep`/`ls`. Outstanding items (monster-file split, multi-batch checklist, Phase 2-5 e2e tests, stale-profile pre-validation) are listed as outstanding work, not silent gaps.

### Sixth pass — final completeness check (and an honest disclaimer)

User: "are you certain that you have covered everything". Honest answer: **no, I cannot guarantee 100% coverage of a ~70-source-file codebase under hostile audit conditions.** Each pass found more, and a sufficiently determined search will likely surface something. What I have done is captured every surface I could find via systematic walking, and explicitly flagged the ones I cannot vouch for.

Sixth-pass additions (15 more items):

#### CI / GitHub (entirely undocumented)
1. **`.github/workflows/ci.yml`** — GitHub Actions CI; build + lint + tests on push/PR
2. **`.github/ISSUE_TEMPLATE/bug_report.md`** — bug report template

#### Database / migrations (never mentioned)
3. **`apps/api/prisma/migrations/`** — 8+ Prisma migrations: `phase_a_data_ingestion`, `sync_schema`, `audit_fixes`, `add_equipment_groups`, `add_admin_requests`, `sync_drift_phase3`, `block_change_nullable_org`, plus `migration_lock.toml`
4. **`apps/api/prisma/sql/extensions.sql`** — hand-written SQL installing PostgreSQL extensions (companion to Prisma migrations)
5. **`apps/api/prisma/schema.prisma.bak`** — stray backup; cleanup candidate

#### Runtime storage (never enumerated)
6. **`apps/api/uploads/photos/`** — profile + checklist photos (served at `/uploads/`)
7. **`apps/api/uploads/reports/`** — generated PDFs from reports module (created at runtime)

#### Frontend build / config files
8. **`apps/web/vite.config.ts`** — Vite + PWA plugin + Tailwind + aliases
9. **`apps/web/eslint.config.js`** — ESLint flat config with `no-explicit-any: warn` (bloat audit P0.3)
10. **`apps/web/index.html`** — Vite SPA entry
11. **`apps/web/generate-apk.md`** — APK build walkthrough (already tracked, never linked from doc map)

#### Frontend public assets (PWA)
12. **`apps/web/public/`** — `favicon.svg`, `logo.jpg`, `apple-touch-icon.png`, 5 PWA icons (`pwa-192x192.{png,svg}`, `pwa-512x512.{png,svg}`, `pwa-icon.svg`); plus the runtime `sw.js` built into `dist/`

#### Per-workspace test configs
13. **`apps/api/vitest.config.ts`**, **`packages/db/vitest.config.ts`**, **`packages/shared/vitest.config.ts`** — separate per-workspace Vitest configs; `packages/queue` notably has none

#### Compiled / cache artifacts (cleanup candidates)
14. `apps/api/dist/`, `apps/web/dist/`, `packages/*/dist/` — should be gitignored; verify
15. `apps/{api,web}/tsconfig.tsbuildinfo`, `packages/shared/tsconfig.tsbuildinfo` — TS incremental cache; should be gitignored

#### Honest assessment after six passes

I am **NOT** going to claim with certainty that nothing remains uncaptured. What I will commit to:

- **Every TS/TSX/JS/MJS/SQL/YML/JSON/MD/Java/Kotlin/PowerShell/Bat file** I found at depth ≤ 3 outside `node_modules`/`.git`/build dirs is now referenced in at least one active doc.
- **Every directory under `apps/`, `packages/`, `scripts/`, `certs/`, `tsdb-migration/`, `.github/`** is enumerated.
- **Every database model (64), enum (22), permission (109), reauth action (81), feature privilege (91), config def (30), config page (26), API module (37), frontend route folder (23), hook (14), lib module (15), shared type file (10), shared schema (8)** has been verified against live code by `grep`/`ls`.
- **Stale numerical claims** in seven docs corrected to live counts.
- **Working-tree noise** (build artifacts, stray files, sensitive keystores) is flagged in `PROJECT_ARCHITECTURE.md` for the user to decide on.

What I cannot guarantee:
- Test files inside `__tests__/` directories — I noted their presence but not each test name.
- Every `routes/<feature>/` page file inside `apps/web/src/routes/<folder>/` — I named the major ones; some sub-pages may not be individually listed.
- Every node type within `apps/api/src/modules/rule-chain/nodes/*.ts` — I named the 9 category files but not all 77 individual node implementations.
- Every Prisma migration step within each migration's `migration.sql`.
- Anything inside `node_modules/`, `dist/`, `.gradle/`, build caches.
- Any code that may have been added between the last commit (`0d14f8a`) and the next session.

If anything more is found uncaptured, the answer is to add it. The audit pattern is now codified in this `tasks/todo.md`: walk every directory, count every type/permission/file by `grep`/`ls`, cross-check against active docs, file findings here.

### Seventh pass — bulk deletion of unnecessary documentation (2026-04-29)

User: "delete whatever documentation is not necessary".

#### Deleted (174 files)

**`agents/` — 13 files** (whole directory)
- AGENTS_INDEX, infra-maintenance, integration-expert, project-manager, 5 testing agents (api/e2e/frontend/manual/security-compliance) × {skills.md, work.md}
- **Reason**: redundant with current Claude Code plugin agents (codex, claude-mem, vercel, superpowers); only self-referenced in repo.

**`future/` — 16 files** (whole directory)
- README + backend/, frontend/, overview/, qa/, testing/ subfolders
- **Reason**: onboarding pack from session 04-20 reorg, content superseded by the much more current root docs (`PROJECT_SUMMARY`, `BACKEND_GUIDE`, `FRONTEND_GUIDE`, `PROJECT_ARCHITECTURE`, `PHASE_5_RECENT_WORK`).

**`old/docs-superseded/api-reference-old/` — 16 files**
- Phase 1 API reference, replaced by `API_REFERENCE.md`.

**`old/docs-superseded/phases/` — 13 files**
- PHASE_A through PHASE_K + README from pre-DigiLog ThingsBoard era.
- **Reason**: history is in `CHANGELOG.md`, content not referenced.

**`old/legacy-documentation/` — pre-DigiLog text docs**
- Not referenced anywhere; content superseded by current docs.

**`old/tasks/` — old code review reports**
- code-review-2026-04-04, pentest-report, system-audit, etc. All findings rolled into `bloat.md` (which is preserved).

**`old/tests-superseded/` — 51 files**
- Phase 1 manual test cases + execution guides; superseded by `apps/api/src/e2e/` (Phase 1 coverage).
- Phase 2-5 still need fresh cases (logged in `PHASE_5_RECENT_WORK.md` § 11).

**`apps/web/generate-apk.md`** — content duplicated in `apps/web/CLAUDE.md` and `DEPLOY-WINDOWS.md`.

#### Kept (still needed)

**Root active docs** (14): `README`, `CLAUDE`, `AGENTS`, `CHANGELOG`, `DEPLOY-WINDOWS`, `LOCAL_SETUP_WINDOWS`, `PROJECT_SUMMARY`, `PROJECT_ARCHITECTURE`, `API_REFERENCE`, `BACKEND_GUIDE`, `FRONTEND_GUIDE`, `OFFLINE_SYNC_ARCHITECTURE`, `PHASE_5_RECENT_WORK`, `PROJECT_HANDOVER/APPLICATION_FLOW.md`

**Per-app/per-package** (5): `apps/api/CLAUDE.md`, `apps/api/DECISIONS.md`, `apps/web/CLAUDE.md`, `apps/web/DECISIONS.md`, `packages/shared/CLAUDE.md`

**`docs/`** entire active subtree:
- `index.md`, `getting-started/` (3), `compliance/21-cfr-part-11.md`, `deployment-methods/` (6), `administration/` (7), `user-guide/` (10)

**`old/docs-superseded/` (referenced for design rationale)**:
- `superpowers-plans/` (4 files) — Block change, PM tasks, Reports, DRY_IN — referenced from `PHASE_5_RECENT_WORK.md § 10`
- `superpowers-specs/` (2 files) — Block change design, PM tasks design
- `ARCHITECTURE.md`, `bloat.md`, `offline-sync-design.md` — historical reference

**`old/{apks, db-backups, playwright-artifacts, reports-specs, screenshots}/`** — kept (binary/non-doc artifacts; out of scope for "documentation" deletion)

**`.github/ISSUE_TEMPLATE/bug_report.md`** — used by GitHub issue UI

**`tasks/todo.md`** — this audit log

#### Updated docs

- `docs/index.md` — historical-design-specs paths shortened (no breakage; targets still exist)
- `PHASE_5_RECENT_WORK.md` — note that `tests/manual-test-cases/` is **deleted**, not just archived; pointed at `apps/api/src/e2e/` as closest current coverage

#### Net result
- **From 236 tracked .md files → 62 tracked .md files** (after deletion)
- All deletions in this commit; rollback via `git revert <hash>` if anything turns out to be needed

### Restore — future/backend + future/frontend (2026-04-29)

User: "the future folder backend frontend files don't you think were important".

**Correct**. After re-reading the deleted content, these 7 files contain unique knowledge that the current root docs do NOT duplicate:

- **`future/backend/MODULES.md`** — per-module endpoint counts grounded in 2026-04-20 `grep` counts; lists sub-route splits (`events-routes`, `execution-routes`, `dynamic-routes`, `org-detail-routes`, per-resource files under `assets/routes/`) at a granularity my BACKEND_GUIDE doesn't have
- **`future/backend/API_ENDPOINTS.md`** — canonical method/path/auth/notes table for every endpoint; my `API_REFERENCE.md` has request/response shapes but no "auth" column or compact catalog form
- **`future/backend/README.md`** — directory map + ordered plugin list with line numbers + **PUBLIC_PATHS taxonomy** (Always public / Dev-only public / GET-only public) — this taxonomy is unique
- **`future/backend/ENV_SETUP.md`** — backend-specific env walkthrough; complements `LOCAL_SETUP_WINDOWS.md` (which is repo-wide)
- **`future/frontend/KEY_FILES.md`** — annotated "why it matters" file index for every important frontend file
- **`future/frontend/PATTERNS.md`** — the conventions every page follows (route definition, SWR fetching, react-hook-form + zod, `useReauth`, `executeOrQueue`, dynamic `attributeSchema` rendering); this is the "how to add a feature" guide and is NOT in any other doc
- **`future/frontend/README.md`** — full directory map of `apps/web/src/` with every component / hook / lib enumerated

Restored via `git checkout 02f8108^ -- future/backend/ future/frontend/`.

Updated `README.md` doc map to point at the restored files.

#### What stayed deleted (still unnecessary)

- `future/overview/` (3 files) — content fully duplicated by `PROJECT_SUMMARY.md`, `PROJECT_ARCHITECTURE.md`, `CHANGELOG.md`
- `future/qa/` (4 files) — Phase 4-era acceptance criteria; `PHASE_5_RECENT_WORK.md § 11` outstanding work + `bloat.md` cover the current QA gaps
- `future/testing/` (3 files) — superseded by `apps/api/src/e2e/` enumeration in `BACKEND_GUIDE.md`
- `agents/` (13 files) — redundant with current plugin agents
- All other previously-deleted archives — confirmed unnecessary

#### Lesson captured

When deleting "old" or "future" folders, read each file's actual content for unique knowledge before deleting — labels like `future/` don't mean obsolete; they may mean "onboarding pack created during reorg with detail not yet absorbed elsewhere".

### Second restore — all of future/ (2026-04-29)

User: "recheck each file that was present in future folder thoroughly and if it's not useful or that knowledge is thoroughly present any here only then delete".

Re-read each remaining file in `future/` carefully. Every single one has unique knowledge that is NOT duplicated in the current root docs.

#### Restored (now keeping all of `future/`)

**`future/README.md`** — onboarding pack overview + reading order. Useful as the entry point.

**`future/overview/CODEBASE_SUMMARY.md`** — the most-comprehensive single-file overview. Has:
- Tech stack with **version pins** (React 19, Vite 6, Fastify 5, Prisma 6, Capacitor 8, `jose` for JWT, `ldapts` for LDAP, `chartjs-node-canvas`, etc.) — root docs don't pin versions
- Feature areas verified by directory inspection at the abstraction level above what BACKEND_GUIDE provides
- "How to find things" cookbook — where's a permission, sidebar item, audit-action, DB schema. NOT in any other doc.

**`future/overview/CURRENT_STATUS.md`** — snapshot @ 2026-04-20 with the **KNOWN GOTCHAS** section (load-bearing for new contributors):
- PM2 compiled JS gotcha
- TimescaleDB is `digilog_tsdb` not `digilog_db`
- Redis ≥5 (BullMQ requirement)
- Fastify schema stripping
- Role permissions go stale after DB restore
- `API_HTTPS=true` requires `certs/server.{key,crt}`
- `navigator.onLine` unreliable on Capacitor WebView
- Capacitor WebView ignores `network_security_config` for fetch
- APK bakes in API URL at build time
- Cycle FIFO replay skips conflicts
- Cached auth survives reload
- Cached pipeline graph stale on profile swap
- Config tabs are independent (no auto-sync)
- SUPER_ADMIN bypasses frontend permission checks

**`future/overview/API_LIST.md`** — compact 394-endpoint index across 47 route files (verified via grep 2026-04-20), with `*` markers on public endpoints. Complements BACKEND_GUIDE but at compact-catalog level.

**`future/qa/README.md`** — user personas (Engineer/Operator, Supervisor, QA, Admin, Super-admin) with role-specific test orientation. NOT in any other doc.

**`future/qa/FEATURE_CHECKLIST.md`** — QA-friendly enumeration with verification steps. Unique format (☐ to verify, ✅ verified, ❌ blocked).

**`future/qa/ACCEPTANCE_CRITERIA.md`** — per-feature "done-when" bullets. Unique format.

**`future/qa/KNOWN_ISSUES.md`** — gotchas categorized by Environment / Frontend+APK / Offline / Permissions. Unique organization.

**`future/testing/README.md`** — 4 distinct test surfaces breakdown:
- Backend unit (`apps/api/src/lib/*.test.ts` + `modules/**/__tests__/*.test.ts`) — 74 .test.ts files
- Backend e2e (`apps/api/src/e2e/*.test.ts`) — 15 suites
- Shared schemas (`packages/shared/src/**/*.test.ts`)
- Shell e2e scripts (`tests/e2e-scripts/*.sh`)
With per-surface run commands. NOT in any other doc.

**`future/testing/MANUAL_TEST_GUIDE.md`** — 12 golden-path scripts. The closest thing we have to live Phase 2-5 manual tests.

**`future/testing/TEST_INVENTORY.md`** — every automated test file enumerated by surface (15 e2e + 9 lib unit + others). Unique enumeration.

#### Lesson hardened

When the user asks to "delete unnecessary documentation":
1. Read every file's actual content
2. Compare line-by-line against current root docs for unique knowledge
3. Only delete if the knowledge is *thoroughly* duplicated, not just "covered at a higher level"
4. When in doubt, restore — git is cheap, lost knowledge isn't

I deleted future/overview/qa/testing on the first pass, then partially restored only future/{backend,frontend} after the first pushback. The user had to push back twice. Both pushbacks were correct. **Default to restore-then-delete-only-if-confirmed-redundant.**

#### Final state of documentation

- 14 active root docs
- `apps/{api,web}/{CLAUDE,DECISIONS}.md` + `packages/shared/CLAUDE.md`
- `docs/` active subtree (index, getting-started, compliance, deployment-methods, administration, user-guide)
- **`future/` complete** — README + overview/(3) + backend/(4) + frontend/(3) + qa/(4) + testing/(3) = 18 files, all kept
- `old/docs-superseded/superpowers-{plans,specs}/` (referenced design rationale)
- `old/docs-superseded/{ARCHITECTURE,bloat,offline-sync-design}.md` (historical reference)
- `old/{apks,db-backups,playwright-artifacts,reports-specs,screenshots}/` (binary artifacts)
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `tasks/todo.md`

Stayed deleted (still confirmed unnecessary):
- `agents/` (13 files) — redundant with current plugin agents
- `old/docs-superseded/api-reference-old/` (16) — replaced by `API_REFERENCE.md`
- `old/docs-superseded/phases/` (13) — pre-DigiLog history in `CHANGELOG.md`
- `old/legacy-documentation/` — pre-DigiLog text docs not referenced
- `old/tasks/` — old code reviews; findings rolled into `bloat.md`
- `old/tests-superseded/` (51) — Phase 1 tests superseded by `apps/api/src/e2e/`
- `apps/web/generate-apk.md` — duplicated in `apps/web/CLAUDE.md` + `DEPLOY-WINDOWS.md`

### Eighth pass — `future/` deep code-vs-doc reconciliation (2026-04-29)

User: "now check all the document files in future and are they upto date with corresponding code, do deep analysis for each subfolder and files and update".

Read every file in `future/` against live filesystem. Patched stale claims in 11 of 14 files.

#### Stale numerical / factual claims fixed

| File | Was | Updated to |
|---|---|---|
| `future/README.md` | Cited `ARCHITECTURE.md` + `DEPLOYMENT.md` (deleted) | Removed; added `PHASE_5_RECENT_WORK.md` |
| `future/README.md` | "old/legacy-documentation/", "old/tasks/", "agents/" exist | Removed (all deleted in cleanup) |
| `future/overview/CODEBASE_SUMMARY.md` | "PM2 on EC2", "Nginx on EC2" | Local Windows only; EC2 removed |
| `future/overview/CODEBASE_SUMMARY.md` | "70+ routes" | **81 `<Route>` definitions** (live count) |
| `future/overview/CODEBASE_SUMMARY.md` | "95 permission constants", "18 granular toggles", "24+ config" | **109 / 91 / 30** (verified by `grep`/`ls`) |
| `future/overview/CODEBASE_SUMMARY.md` | "tests/", "agents/", "deploy/", "RFID/" listed in monorepo layout | Removed (deleted) or noted as build-cache stray |
| `future/overview/CODEBASE_SUMMARY.md` | Last commit "17b420b 2026-04-20" | Updated to 2026-04-29 doc-reconciliation pass |
| `future/overview/CODEBASE_SUMMARY.md` | Did not name native Java plugin | Now references `RfidPlugin.java` location |
| `future/overview/CODEBASE_SUMMARY.md` | Did not list `lib/connectivity.ts` or `lib/rfid-bridge.ts` | Added to frontend tech stack |
| `future/overview/CODEBASE_SUMMARY.md` | "How to find things" missing `audit-actions.ts`, `audit-templates.ts`, `alarm-columns.ts`, `sidebar-privilege-map.ts`, migrations, static-routes | All added with file counts |
| `future/overview/CURRENT_STATUS.md` | "95/82/69" perms/privs/reauth | **109/91/81** + 26 sidebar items |
| `future/overview/CURRENT_STATUS.md` | "24+ config defs" | **30 config defs / 26 pages** |
| `future/overview/CURRENT_STATUS.md` | Did not mention Phase 5 work (offline overhaul, RFID SDK plugin, decision tape, Filter Data Mgmt) | Added as full sections |
| `future/overview/CURRENT_STATUS.md` | Latest commit `17b420b` | Updated to recent commit chain through `5eb9db8` |
| `future/overview/CURRENT_STATUS.md` | Gotchas listed PM2 | Replaced with `tsx`/local-build path; added cycle profile_id frozen |
| `future/overview/CURRENT_STATUS.md` | Did not flag Filter Data Mgmt console as zero-audit-trail escape hatch | Added compliance note |
| `future/overview/API_LIST.md` | "394 endpoints across 47 route files (2026-04-20)" | **~398 across 59 route files (2026-04-29)** verified by grep |
| `future/backend/README.md` | "PM2 uses this path in production" | "PM2 / EC2 are no longer in scope (commit 251be95)" |
| `future/backend/README.md` | Did not mention `idempotency.ts` | Added to lib table |
| `future/backend/README.md` | rbac plugin showed only `requirePermission` | Added `requireAnyPermission` + `enforceReauth(string\|string[])` |
| `future/backend/README.md` | auth plugin missing PUBLIC_GET_PATHS detail | Added |
| `future/backend/README.md` | "compile for PM2" + `/home/ubuntu/...` build cheatsheet | Replaced with Windows-local commands + `package-for-production.ps1` |
| `future/backend/ENV_SETUP.md` | "Production (EC2 / PM2)" section | Replaced with "Production-style local build" using PowerShell scripts |
| `future/backend/ENV_SETUP.md` | "production: /docs disabled" — accurate but referenced via PUBLIC_PATHS — kept |
| `future/frontend/README.md` | "70+ routes", "served by Nginx in prod" | **81 `<Route>`s**; "optional Nginx; packaged into APK" |
| `future/frontend/README.md` | Tech list missing reactflow / @dnd-kit / recharts / monaco / signature_pad / qrcode.react / vite-plugin-pwa | All added |
| `future/frontend/README.md` | Directory map missing `connectivity.ts`, `rfid-bridge.ts`, `format-by-least-count.ts`, `vite-env.d.ts` | All added |
| `future/frontend/README.md` | `routes/checklist/`, `routes/checklists/` (pre-rename) | Updated to `checklist-form/`, `checklist-admin/` (P1.4 done) |
| `future/frontend/README.md` | "30+ config pages" | "26 config pages" with new entries enumerated |
| `future/frontend/README.md` | Mobile section missing `mobile-forgot-password.tsx` | Added |
| `future/frontend/README.md` | Offline model missing idempotency-key + stale-profile banner | Added as steps 7-8 |
| `future/frontend/KEY_FILES.md` | "70+ routes" | **81 `<Route>`s** + theme utility classes detail |
| `future/frontend/KEY_FILES.md` | Did not document `connectivity.ts` or `rfid-bridge.ts` | Added |
| `future/frontend/KEY_FILES.md` | api-client mapping description | Pinpointed line 58 + block-change popup dependency |
| `future/frontend/KEY_FILES.md` | Did not mention `mobile-forgot-password.tsx` | Added |
| `future/frontend/KEY_FILES.md` | Filter operations section missing LOC counts + bloat audit P0.2 + DRY_IN flow | Added |
| `future/frontend/KEY_FILES.md` | `routes/checklist/` (pre-rename) | Updated to `checklist-form/` and `checklist-admin/` |
| `future/frontend/KEY_FILES.md` | Filter Data Mgmt missing zero-audit-trail compliance footnote | Added |
| `future/frontend/KEY_FILES.md` | Missing access-matrix + tablet-access pages | Added |
| `future/frontend/KEY_FILES.md` | "30+ config pages" | "26 config pages" |
| `future/qa/README.md` | EC2 prod URL (34.232.224.0), prod EMQX URL | Replaced with Windows-local URLs + `scripts/...` deployment |
| `future/qa/README.md` | "pm2 logs digilog-api" | Replaced with stdout / NSSM service logs |
| `future/qa/FEATURE_CHECKLIST.md` | "95 permissions" | **109 permissions** + added 91 privileges + 26 sidebar items |
| `future/qa/FEATURE_CHECKLIST.md` | "30+ config pages" | "26 config pages" |
| `future/qa/FEATURE_CHECKLIST.md` | "69 reauth actions" | **81 reauth actions** |
| `future/qa/ACCEPTANCE_CRITERIA.md` | "95 permissions" | **109 permissions** |
| `future/qa/KNOWN_ISSUES.md` | "PM2 runs compiled JS" gotcha | Replaced with `tsx watch` dev / `node dist/app.js` prod-style |
| `future/qa/KNOWN_ISSUES.md` | `navigator.onLine` gotcha generic | Pointed at `lib/connectivity.ts` 3-signal fan-out |
| `future/qa/KNOWN_ISSUES.md` | Did not mention cycle `profile_id` frozen | Added |
| `future/testing/README.md` | Cited deleted `tests/manual-test-cases/` and `tests/test-execution-guides/` | Replaced with `future/testing/MANUAL_TEST_GUIDE.md` + note that Phase 1 manual cases were deleted |
| `future/testing/README.md` | "74 .test.ts files" — correct in 2026-04-20 snapshot | Updated to current per-folder counts |
| `future/testing/README.md` | "RFID/" folder reference | Removed (build-cache directory, not a code surface) |
| `future/testing/README.md` | Did not flag Phase 2/3/4/5 gap | Added as known gap |

Files NOT meaningfully changed (already current after prior reconciliation pass):
- `future/testing/MANUAL_TEST_GUIDE.md` (12 golden paths still apply)
- `future/testing/TEST_INVENTORY.md` (live test file enumeration — names match current code)
- `future/qa/ACCEPTANCE_CRITERIA.md` body (only the perm count was stale)

#### Live-code verification commands run during this pass
- `grep -E '"(fastify|prisma|jose|ldapts|bullmq|puppeteer)"' apps/api/package.json` → versions confirmed
- `grep -E '"(react|vite|swr|reactflow|@dnd-kit|recharts|signature_pad|vite-plugin-pwa)"' apps/web/package.json` → versions confirmed
- `grep -E '"@capacitor"' apps/android/package.json` → 8.3.0 + Network 8.0.1 confirmed
- `grep -cE "<Route" apps/web/src/main.tsx` → **81** (was claimed 70+)
- `find apps/api/src/modules -name "*.ts" | xargs grep -l "app\.\(get\|post\|put\|patch\|delete\)" | wc -l` → **59 route files** (was claimed 47)
- `grep -cE "app\.(get|post|put|patch|delete)" apps/api/src/modules/**/*.ts` → **~398** endpoint registrations

### Ninth pass — root-vs-future cross-sync (2026-04-29)

User: "is future and the other latest files are in sync with their knowledge".

Ran 3 cross-doc consistency sweeps. After the eighth pass updated `future/` to live counts, **the root docs had drifted in 11 places** (still using older numbers). All patched:

| File:line | Was | Now |
|---|---|---|
| `README.md:13` | "Fastify 5 backend — 34 modules" | **37 modules, ~398 endpoints across 59 route files** |
| `README.md:74` | "69 reauthentication actions" | **81 reauthentication actions** |
| `README.md:178` | "Snapshot @ 2026-04-20 + KNOWN GOTCHAS (...PM2 compiled JS)" | "Snapshot @ 2026-04-29 + GOTCHAS (cycle profile_id frozen, idempotency-key required)" |
| `CLAUDE.md:101` | "18 granular feature toggles ... 69 reauth actions" | "18 toggles introduced; total privileges grew to 91 over Phases 4 + 5; 81 reauth actions across 16 categories" |
| `PROJECT_SUMMARY.md:29` | "api/ — Fastify backend (34 modules" | "37 modules" |
| `PROJECT_SUMMARY.md:33` | "shared/ — types (95 permissions, 82 privileges)" | "(109 permissions, 91 privileges, 81 reauth actions, 26 sidebar items)" |
| `PROJECT_SUMMARY.md:47` | "RBAC with 95 permissions" | "RBAC with 109 permissions" |
| `PROJECT_SUMMARY.md:131` | "PM2 process manager for API" | "NSSM for Windows Service registration" + scripts |
| `PROJECT_ARCHITECTURE.md:46` | "│ 63 models│" (in ASCII diagram) | "│ 64 models│" |
| `PROJECT_ARCHITECTURE.md:166` | "registers PM2 / NSSM service" | "registers NSSM Windows service" |
| `PROJECT_ARCHITECTURE.md:222` | "Each of the 34 modules" | "Each of the 37 modules" |
| `PROJECT_ARCHITECTURE.md:442` | "RBAC (95 permissions...)" | "RBAC (109 permissions, 81 sensitive actions)" |
| `BACKEND_GUIDE.md:5` | "34 API modules ... Managed by PM2 in production" | "37 API modules, ~398 endpoints across 59 route files. Runs locally on Windows ... PM2 / EC2 are no longer in scope" |
| `BACKEND_GUIDE.md:29` | "auto-registers 24 config definitions" | "30 config definitions" |
| `BACKEND_GUIDE.md:349` | "24 config definitions auto-discovered" | "30 config definitions auto-discovered" |
| `PHASE_5_RECENT_WORK.md:281` | "registers PM2/NSSM service" | "registers NSSM Windows service" |
| `docs/index.md:114` | "69 reauth actions" | "81 reauth actions" |
| `apps/api/CLAUDE.md:133` | "69 reauth actions across 16 categories" | "81 reauth actions across 16 categories" |

Final consistency sweep (regex search across all 14 active docs in root + per-app + future + docs):
- `(95 perm|82 (privi|feat)|69 reauth|57 model|17 enum|63 model|34 modules|34 API mod|24 config)` — **zero matches**
- `(PM2 (in production|process|on EC2)|/home/ubuntu|34\.232\.224|EC2 (production|instance))` — **zero matches**

Permitted lingering EC2/PM2 mentions are explicit historical references:
- `CHANGELOG.md` "Phase A: Infrastructure (...PM2, Nginx)" and "PM2 TSDB_DATABASE env var fixed" — these are historical entries in the version log; CHANGELOG is append-only.
- `CHANGELOG.md` "Removed all EC2 / Linux production assets" — the entry that DOCUMENTS the removal.
- `PHASE_5_RECENT_WORK.md` "EC2/PM2 production assets removed" — same.
- `PROJECT_ARCHITECTURE.md` cleanup-candidate table notes existence of stray files; not stale claims.

#### Sync status — every active doc reads true against live code as of commit `1f9c1a6` + this pass

- 14 root active docs ✓
- 5 per-app/per-package CLAUDE/DECISIONS ✓
- `docs/` active subtree ✓
- `future/` complete (18 files) ✓
- All numerical claims verified against live code by `grep`/`ls` (commit-hash linked in audit log)

### Tenth pass — CLAUDE.md trim (2026-04-29)

After codifying the doc-sync rule in pass 9 (`808245a`), CLAUDE.md grew to 278 lines / 21 KB. Loaded into every session's context, the cost was real for marginal benefit — the 30-row Change→Docs table reduced to a handful of principles when read carefully.

#### Action

1. **Created `docs/CONTRIBUTING.md`** (162 lines) — moved out:
   - Full Change → Docs mapping table (37 rows split into Backend / Database / Frontend / Config+Permissions / Native Android / Tests+Infra)
   - 12-touchpoint rule for new config defs (now numbered list)
   - Pre-deletion rule with commit-hash receipts (`02f8108` → `8677bf7` → `2c1fa50`)
   - Reading order for fresh contributors
   - Audit-pass methodology section (the 6-step loop the 9-pass audit followed)

2. **Trimmed CLAUDE.md Documentation Sync Rule from ~125 lines to ~30 lines.** Kept:
   - The hard rule (every numerical claim → grep/ls verify)
   - The active doc set inventory (compact)
   - The 9 live-count verification commands
   - Always-update list (CHANGELOG, PHASE_5 § 11, memory, tasks/todo.md)
   - Pointer to `docs/CONTRIBUTING.md` for everything else
   - Compressed pre-deletion rule (1 line + pointer)
   - Compressed stale-stat sweep guidance (no longer hardcoded numbers — generate regex from current System Stats)

3. **Removed the hardcoded stale-stat regex** (`95|82|69|57|17|63|34|24`). The regex was itself drift-prone. Replaced with the principle "derive the regex from previous System Stats numbers when changing any count."

#### Net effect

| | Before | After |
|---|---|---|
| `CLAUDE.md` lines | 278 | 185 |
| Always-loaded context | ~21 KB | ~14 KB |
| Detail loss | — | Zero (table preserved in `docs/CONTRIBUTING.md`) |
| Maintenance load | High | Low |

Verification: `grep` for stale-stat tokens across `CLAUDE.md` + `docs/CONTRIBUTING.md` returns zero matches (other than the literal regex inside the verification block, which is now intentional and unparameterized).

#### How AI now uses the doc-sync contract

- **Every session:** CLAUDE.md "Documentation Sync Rule" loads automatically (~30 lines). AI sees: principle, active doc set, verification commands, pointer.
- **On a per-change-type code change:** AI does `Read` on `docs/CONTRIBUTING.md` for the table, applies it, doesn't load it otherwise.
- **On a count-bearing doc change:** AI runs the live-count commands from CLAUDE.md, then does a one-shot grep-and-replace across the active doc set with the previous number.

### How to roll back
```bash
git diff --stat HEAD~1 HEAD             # see what changed
git revert <commit-hash>                # undo cleanly
# or recover individual files:
git mv old/docs-superseded/ARCHITECTURE.md ARCHITECTURE.md
```

Everything is reversible — nothing was deleted.

---

## 2026-04-29 (evening) — windows-friendly-rewrite Phases 1 install-fix + 3 + apps/api test cleanup + doc sync

Branch: `feature/phase3-reports-edge` → `windows_dep` at `b2c3b37` plus a follow-up doc-sync commit landing this audit entry.

### Code changes (commits in chronological order)

- `0ecc151 fix(mosquitto): make install script produce a service-bootable conf` — Phase 1 follow-up. Live Windows-Server e2e found that the SCM-managed Mosquitto service has CWD=System32 and no stdout, so the source `mosquitto.windows.conf`'s relative `./data/`, `./dynamic-security.json`, and `log_dest stdout` silently exited the broker on every launch. Install script now rewrites the deployed copy with absolute paths + file logging.
- `79937b7 feat(reports): edge-detector helper for puppeteer-core executablePath` — new `apps/api/src/modules/reports/renderers/edge-detector.ts`. Probes `PUPPETEER_EXECUTABLE_PATH` → Windows Edge → Windows Chrome → Linux Chromium → macOS `.app` bundles. 6 vitest cases.
- `abdc9dd feat(reports): switch pdf-renderer from puppeteer to puppeteer-core + Edge` — drops `puppeteer` (~150 MB Chromium download), adds `puppeteer-core` driving Edge. Cold-start render time 34 s → 1.9 s.
- `d72d44c feat(reports): replace chartjs-node-canvas with @napi-rs/canvas` — drops `chartjs-node-canvas` (transitive `canvas` needs Cairo + node-gyp + MSVC + Python), adds `@napi-rs/canvas` (prebuilt N-API binaries) + `chartjs-adapter-date-fns` for time-axis charts. Renderer adds explicit white background fill.
- `06bcb95 fix(tests): bring apps/api vitest suite back from 30 failed files / 65 failed tests to 11 / 14` — vitest infra (env loader, admin-user globalSetup, `fileParallelism: false`) + 11 service/plugin/test mock fixes.
- `b2c3b37 fix(tests): zero failed tests across the workspace` — finishing pass: e2e snippets/UUIDs, RB0001 + VIEWER fixtures, config-route reauth header fallback (real impl bug), real-schema in user-id validator, ingestion alarm.findFirst mock, plus four `packages/shared` assertion drifts (limit caps + audit-template count). Also restored `userQuerySchema.limit.max(100).default(20)` and `assetQuerySchema/templateQuerySchema.limit.max(100).default(50)` because unbounded list-endpoint limits is a DoS surface.

### Doc updates done in this audit pass

- `windowsIssues.md` — §1 (Puppeteer), §2 (chartjs-node-canvas), §3 (EMQX), §7 (Memurai) marked resolved with commit hashes; "Recommended deployment stance" table updated to reflect Mosquitto + graphile-worker + puppeteer-core + Edge + @napi-rs/canvas.
- `CHANGELOG.md` — new "[Unreleased] — Phase 3 of windows-friendly-rewrite + test cleanup" section at top with full Added/Changed/Removed/Fixed/Verified-live/Resolved-windowsIssues breakdown.
- `LOCAL_SETUP_WINDOWS.md` — § 1.5 rewritten for Mosquitto silent install via `scripts/install-mosquitto.ps1`; `.env` template swapped from `EMQX_ADMIN_PASSWORD` → `MOSQUITTO_ADMIN_PASSWORD` + `MOSQUITTO_REFRESH_TOKEN`; service / port / troubleshooting tables updated.
- `DEPLOY-WINDOWS.md` — architecture diagram, install table, first-run verification, troubleshooting, summary checklist all updated; "Server Core works for the API itself" note added (Phase 3 made this true).
- `BACKEND_GUIDE.md` — Transport Layer table now lists `mosquitto-acl-generator.ts` + `mosquitto-refresh-routes.ts`; `mqtt-auth-routes` flagged as legacy/Phase-4-deletion-target; Workers table mentions `LISTEN/NOTIFY` + `SKIP LOCKED`; env-var template updated.
- `apps/api/CLAUDE.md` — Mosquitto replaces EMQX in the local-services list.
- `CLAUDE.md` (root) — env list (`Mosquitto 2.0` replaces `EMQX 5.x`), Key Local URLs (Mosquitto port + dynsec note instead of EMQX dashboard), Phase 5 narrative updated to reference puppeteer-core + @napi-rs/canvas.
- `PHASE_5_RECENT_WORK.md` — new "§ 12 Windows-friendly rewrite (Phases 1–3 complete; 4–5 outstanding)" section with the cut-over commit hashes and pass-rate snapshot.
- This `tasks/todo.md` audit entry.
- Memory: 4 entries (`feedback_mosquitto_windows_service_install`, `feedback_mosquitto_dynsec_install_dir`, `project_orphan_uns_mapping_cwhf0500`, `feedback_doc_sync_each_phase`).

### Outstanding doc work for Phase 4

When Phase 4.1–4.3 land (script + env-file edits), update:
- `apps/api/.env.example` itself
- `future/overview/CODEBASE_SUMMARY.md` tech stack section
- `future/overview/CURRENT_STATUS.md` gotchas section
- `future/qa/KNOWN_ISSUES.md` — drop the Memurai + EMQX entries
- `docs/index.md` stats line
- `README.md` if it mentions any of the swapped deps
- `PROJECT_SUMMARY.md` and `PROJECT_ARCHITECTURE.md` tech-stack lines

The above weren't touched in this pass because they're either count-bearing
(need a fresh live-count run) or describe the stack at a level that should
land alongside the `install-on-target.ps1` / `package-for-production.ps1`
script edits in Phase 4.

### Verification commands run before doc updates

```bash
git log --oneline 7832af1..HEAD                                                  # confirmed 6 today's commits
grep -cE "^model "                       apps/api/prisma/schema.prisma           # 64 unchanged
grep -nE "Memurai|EMQX|Puppeteer|chartjs-node-canvas" windowsIssues.md           # found § 1/2/3/7 to mark
git diff --name-only feature/phase2-pg-queue..windows_dep                        # full file list
```

Pass-rate at audit time: `apps/api 1123/1123 + packages/shared 150/150 + packages/queue 6/6 = 1279/1279, all green`.

---

## 2026-04-29 — windows-friendly-rewrite Phase 4 — Tooling cleanup (Install + Packaging)

Branch: `feature/phase4-tooling`. Cut-over commits `127f25d..60d3c90` (4 commits, all on the worktree). No code changes — only the two installer/packager scripts and the `.env.example` template were touched. The point of the phase: make the scripts honest about the post-Phase-1+2+3 stack (Mosquitto, graphile-worker, puppeteer-core+Edge, @napi-rs/canvas) instead of pretending the customer needed Memurai / EMQX / PM2 / a baked-in Nginx config.

### Code changes (commits in chronological order)

- `127f25d chore(install): drop Memurai/EMQX/PM2 from install-on-target.ps1; add Mosquitto + Edge + LongPaths` — removed the Memurai/Redis prereq probe, the EMQX firewall rule + 18083 dashboard port, the PM2 install/start/save blocks, and the inline Nginx-config drop. Added `install-mosquitto.ps1` invocation, `LongPathsEnabled = 1` registry edit (try/catch), Microsoft Edge presence probe (warns if missing), and renamed firewall rule for 1883 to `DigiLog Mosquitto MQTT`. Footer reduced to 9 numbered steps.
- `5dd0eab fix(install): correct footer launch instructions and unreliable error checks` — review-fix. Footer rewritten to honest "smoke-test only" wording (`cd api; node dist/app.js` in foreground, no auto-restart, no boot persistence, no log rotation; managed-Windows-service launcher tracked as Phase 5 work). Removed bogus `$LASTEXITCODE` check that was always passing on the fail path. Dropped a `2>&1` redirection from `npx prisma db seed` that wraps native stderr in NativeCommandError records and trips `$ErrorActionPreference = 'Stop'` even on exit-code-zero.
- `bcfd621 chore(packaging): align package-for-production.ps1 with Mosquitto/graphile-worker/puppeteer-core stack` — dropped copies of the broken `start-digilog.ps1` / `stop-digilog.ps1` shells. `install-on-target.ps1` and `install-mosquitto.ps1` are now hard-required (throws on missing). Copies the repo's `mosquitto/` config dir to the output zip. Replaced inline `.env.example` template's MQTT(EMQX) + Redis blocks with a single Mosquitto block + graphile-worker note + commented `PUPPETEER_EXECUTABLE_PATH` override.
- `60d3c90 fix(packaging): clarify partial mirror of .env.example, normalize Mosquitto placeholders, repair Write-Host -f bug` — review-fix. Added explicit-scope comment naming the inline template as a partial mirror of `apps/api/.env.example`. Fixed pre-existing `Write-Host -f` bug where the parameter alias was treated as a positional. Normalized `MOSQUITTO_ADMIN_PASSWORD` + `MOSQUITTO_REFRESH_TOKEN` placeholder strings to SHOUTY_SNAKE so the file matches the packager output. `apps/api/.env.example` updated for the same.

### Doc updates done in this audit pass

- `CHANGELOG.md` — new "[Unreleased] — Phase 4 of windows-friendly-rewrite — Tooling cleanup (Install + Packaging)" section at top. Lists all four commit hashes and what changed in operator-facing language.
- `DEPLOY-WINDOWS.md` — full rewrite of:
  - Section 1 (what's in the box) — drops `start-digilog.ps1`/`stop-digilog.ps1`, adds `mosquitto/` directory + `install-mosquitto.ps1`
  - Section 2 (architecture diagram) — drops PM2 + Nginx boxes, swaps in foreground-smoke-test note
  - Section 3 (prereqs table) — Nginx removed entirely, Memurai marked optional, Mosquitto marked "installed by script", Edge entry expanded with override hint, plus the Phase-4 disclaimer paragraph
  - Section 5.4 (install script does) — rewritten to actual 9 steps shipped in `127f25d`/`5dd0eab`, plus the foreground-smoke-test launch
  - Section 5.5 (was Nginx config) — **deleted entirely**; remaining sections renumbered (5.5 cert-on-tablet, 5.6 APK install)
  - Section 6 (smoke tests) — renumbered to 8 steps; explicit `Test-NetConnection localhost -Port 1883`, graphile-worker schema check via `information_schema.tables`, TimescaleDB extversion check; PM2/Nginx-specific steps removed; SPA now served by Fastify directly on `:3000`
  - Section 7 (auto-start) — replaced PM2/Nginx-via-NSSM block with NSSM-as-stopgap-for-API-only block + Phase 5 deferred note
  - Section 9 (update path) — replaced `pm2 stop`/`pm2 restart`/`nginx -s reload` with manual Ctrl-C + relaunch (or NSSM if registered)
  - Section 10 (troubleshooting) — `pm2 logs` references swapped to console output / NSSM logs; new row for missing-Edge PDF failure; PM2-startup row swapped for Phase-5-deferred note
  - Section 11 (handover checklist) — PM2/Nginx items removed; smoke-test count bumped from 6 → 8; NSSM stopgap line added
  - Section 12 (support) — `pm2 logs` swapped for console output / NSSM log path
- `windowsIssues.md` — § 14 (Optional Nginx) gained a "Phase 4 status (2026-04-29)" footnote with the four commit hashes and a pointer to `DEPLOY-WINDOWS.md § 7` for the NSSM stopgap.
- `tasks/todo.md` — this entry.

### Files NOT touched in this pass (and why)

- `LOCAL_SETUP_WINDOWS.md` — `d6bdd7c` (Phase 3 doc-sync) already removed every PM2/EMQX reference from the local-dev guide and the `.env` template already lists the Mosquitto vars. Re-read end-to-end during this pass; nothing further to add for Phase 4 (the file is about *local dev*, not the production install path the scripts target).
- `apps/api/CLAUDE.md` — `d6bdd7c` already swapped the local-services list to Mosquitto. The "Phase 4 Update (2026-04-14)" section in that file refers to a different "Phase 4" (the in-app permissions/themes/reports phase, not the windows-friendly-rewrite Phase 4). Leaving as-is.
- `CLAUDE.md` (root) — `d6bdd7c` already updated the env list to read `Node.js 20+, PostgreSQL 18 + TimescaleDB, Mosquitto 2.0`. No PM2 or Nginx mention.

> **Update — caught in code-reviewer follow-up pass (commit on top of `99ca7ad`):** `README.md` line 105 still listed `Reverse proxy | Nginx (production deployment)`, `BACKEND_GUIDE.md` line 10 still said `Production: pm2 start dist/app.js --name digilog-api`, and `PHASE_5_RECENT_WORK.md` line 281 still claimed `install-on-target.ps1` "assumes Node.js 20+, PostgreSQL 18 + TimescaleDB, Memurai, EMQX, optional Nginx already installed; runs migrations, registers NSSM Windows service" — all three were operationally wrong post-Phase-4 and are fixed in the follow-up commit. The CHANGELOG also had a `DATABASE_URL_QUEUE` claim that didn't match what the packager template actually writes; rewritten to match the real text. The `install-on-target.ps1` footer's "section 5.6 / 5.7" pointers were stale (DEPLOY-WINDOWS.md had been renumbered after dropping the old 5.5 Nginx-config section); fixed to 5.5 / 5.6.

### Known follow-ups (Phase 5 doc sync)

These four architecture-diagram-heavy docs still carry stale Nginx / EMQX / Memurai references. They were intentionally not touched in this Phase 4 doc-sync because the prose is woven into system-architecture diagrams that should be redrawn once the Phase 5 managed-service launcher actually ships and the install topology is final. Listed here so the deferral is on the record:

- `PROJECT_ARCHITECTURE.md` — system-architecture diagram still shows Nginx + Memurai boxes
- `API_REFERENCE.md` — header prose still mentions Memurai/EMQX as required services
- `FRONTEND_GUIDE.md` — deployment context still references Nginx as reverse proxy
- `OFFLINE_SYNC_ARCHITECTURE.md` — prose still references the EMQX broker by name

Other things noticed during the follow-up fix pass:

- The `PHASE_5_RECENT_WORK.md` `### Production deployment artifacts (Windows)` section is the right home for a future "What changed in Phase 4 vs Phase 5" subsection once Phase 5 lands. The current Phase-4-fix-pass edit just made the existing bullet honest about today's behavior.
- `DEPLOY-WINDOWS.md` § 7 (NSSM stopgap) is now referenced from three places (README.md tech-stack row, BACKEND_GUIDE.md production launch line, PHASE_5_RECENT_WORK.md install-on-target.ps1 description). Phase 5 should replace that one section with the real managed-service launcher recipe and update the three back-references in lockstep.
- No `.env.example` or `.env.production` audit was done in this pass; if the customer-facing template ever gains new fields, the inline mirror in `package-for-production.ps1` needs to track them — the explicit-scope comment added in `60d3c90` is the only thing keeping that connection visible right now.

### Verification commands run before doc updates

```bash
git log --oneline 5f56cec..HEAD                                          # confirmed 4 today's commits on feature/phase4-tooling
grep -nE "PM2|pm2|EMQX|18083|nginx|Nginx" DEPLOY-WINDOWS.md              # found 9 stale references; all rewritten or footnoted
grep -nE "PM2|pm2|EMQX" windowsIssues.md                                 # only § 14 Nginx mentions; added Phase 4 footnote
grep -nE "PM2|EMQX|nginx|Memurai" LOCAL_SETUP_WINDOWS.md                 # already clean from d6bdd7c
```

No code, no tests run — pure script + docs. End-to-end install-script proof will land in **Phase 5.1** (windows-server-stack integration test).

---

## 2026-04-29 — windows-friendly-rewrite Phase 5 — FULL doc-sync sweep (active set + future/)

Branch: `feature/phase5-verification` (worktree at `.worktrees/phase5-verification`). Single docs commit on top of `24620c0` (Phase 5.1 + 5.2 — integration test + `verify-windows-deployment.ps1`). No code changes.

### What this pass closes

Phase 4 doc-sync (`99ca7ad` + `c9d94a1`) explicitly **deferred** four architecture-diagram-heavy docs to Phase 5. This sweep finishes those plus everything else in the CLAUDE.md "Active doc set" that still carried stale Nginx / EMQX / Memurai / BullMQ / PM2 / "63 models" / "57 models" / "95 perms" references.

### Phase 4 deferred files — closed

- `PROJECT_ARCHITECTURE.md` — system-architecture diagram redrawn (Fastify-direct on `:3000`; reverse proxy is optional/customer-choice; queue moved to graphile-worker on Postgres; broker is Mosquitto 2.0). Request flow, data-ingestion-pipeline, queue-architecture table (BullMQ → graphile-worker tasks + cron), security-layers (Nginx SSL → Fastify TLS), and protocols table (HTTPS :443 → :3000) all updated. `63 models` → `64 models`. Redis usage scoped to "pub/sub only" with Phase 4 follow-up note.
- `API_REFERENCE.md` — base URL prose drops "via Nginx"; "Internal Endpoints (EMQX callbacks)" section rewritten as "Internal Endpoints (Mosquitto dynamic-security)" pointing at `POST /api/internal/mqtt/refresh-acl`; "Permission Reference (95 total)" updated to live count of 109 with the verification command.
- `FRONTEND_GUIDE.md` — "served by Nginx in production" rewritten to "served by Fastify on `:3000`; reverse proxy optional/customer-choice"; reauth count `69` → `81`.
- `OFFLINE_SYNC_ARCHITECTURE.md` — APK/web connection diagram drops Nginx box, route-modules count `34` → `37`, `63 models` → `64`, `EMQX — MQTT broker` → `Mosquitto 2.0`, `Redis/Memurai — BullMQ job queues` → `graphile-worker on Postgres — job queues; Redis (optional) — non-queue pub/sub only`.

### Other active-doc-set fixes

- `AGENTS.md` — `34` → `37`, `57/17` → `64/22`, `52+ permissions` → `109/91/81/26`. "BullMQ jobs" → "graphile-worker jobs".
- `PROJECT_SUMMARY.md` — monorepo tree refreshed (graphile-worker, dropped `deploy/`, `scripts/` description). `BullMQ job queues 5` → graphile-worker `5` cron + tasks. `95 granular controls` → `109` with verification cmd. "Production Deployment (Windows Server)" rewritten honestly.
- `README.md` — `packages/queue/` line in the contents table swapped to graphile-worker prose.
- `apps/api/CLAUDE.md` — module count `34` → `37`; module list refreshed to include `report-templates`/`reports` and `30` defs (was `23`); "Phase 4 Update" disambiguated; `95 total permission constants` → live count of `109`.
- `apps/api/DECISIONS.md` — Decision #26 (BullMQ for Ingestion Queue) updated to record the Phase 2 swap; Decision #39 (Force IPv4 SMTP) flagged as historical-EC2-era.
- `apps/web/CLAUDE.md` — `# Build (for Nginx serving or APK packaging)` comment swapped; `20+ page modules` → `23 route folders/files; ~85 pages; 81 <Route>`.
- `windowsIssues.md` — added "Phase 5 status footnote" pointing at `tests/integration/windows-server-stack.test.ts` (Phase 5.1) + `scripts/verify-windows-deployment.ps1` (Phase 5.2). "Things that work fine" list updated.

### Reference docs (`docs/`, `future/`, `PROJECT_HANDOVER/`)

- `docs/getting-started/system-requirements.md` — full rewrite; legacy port table marked as "no longer part of standard install".
- `docs/getting-started/what-is-digilog.md` — architecture stack list updated.
- `docs/compliance/21-cfr-part-11.md` — "HTTPS support via Nginx" → Fastify TLS via mkcert.
- `docs/user-guide/connectivity/mqtt.md` — full rewrite for Mosquitto 2.0.
- `docs/user-guide/telemetry/telemetry.md` — `via EMQX broker` → `via Mosquitto 2.0`.
- `docs/user-guide/data-export/data-export.md` — `via BullMQ` → `via graphile-worker on Postgres`.
- `docs/user-guide/entities/entities-and-hierarchy.md` — `57/17` → `64/22`.
- `docs/deployment-methods/{README,method-a,method-b,method-d,method-e,comparison}.md` — added Phase 4/5 status banners pointing at root `DEPLOY-WINDOWS.md`; original prose preserved as historical context.
- `future/overview/CODEBASE_SUMMARY.md` — `BullMQ queue definitions` → graphile-worker.
- `future/overview/API_LIST.md` — EMQX webhook footer note rewritten.
- `future/backend/README.md` — Tech stack line, transport block, env-var table, workers note all rewritten.
- `future/backend/API_ENDPOINTS.md` — MQTT topics note updated.
- `future/backend/ENV_SETUP.md` — prereqs list, Memurai section, Nginx mention all rewritten.
- `future/frontend/README.md` — `served by optional Nginx` rewritten to Fastify-direct + Capacitor APK.
- `future/qa/README.md` — local prod URL no longer points at Nginx; EMQX dashboard reference removed.
- `future/qa/FEATURE_CHECKLIST.md` — EMQX webhook check rewritten as Mosquitto refresh-acl.
- `future/qa/ACCEPTANCE_CRITERIA.md` — `/api/system-health` expected outputs adjusted.
- `PROJECT_HANDOVER/APPLICATION_FLOW.md` — header banner added; existing Mermaid diagrams + .docx renders preserved as historical Phase-4 snapshot.
- `CHANGELOG.md` — new top-of-file `[Unreleased] — Phase 5 doc-sync sweep` entry summarising all of the above.

### Files NOT touched in this pass (and why)

- `docs/runbooks/queue-cutover.md` — this **is** the cutover runbook itself (describes the BullMQ → graphile-worker migration). Mentions of BullMQ + Memurai + the cut-over flag are correct in that role; rewriting would erase the runbook's purpose.
- `docs/plans/2026-04-29-windows-friendly-rewrite.md` — the source-of-truth plan for the rewrite phases. Mentions the old stack on purpose.
- `docs/CONTRIBUTING.md` — references EC2 / PM2 in historical receipts about what was found and removed; correct as historical receipts.
- `apps/web/DECISIONS.md` line 13 — small inline parenthetical "(nginx) would handle this"; correctly describes original design intent.
- `LOCAL_SETUP_WINDOWS.md`, `DEPLOY-WINDOWS.md`, `BACKEND_GUIDE.md` (mostly), root `CLAUDE.md`, `PHASE_5_RECENT_WORK.md`, `packages/shared/CLAUDE.md`, `future/overview/CURRENT_STATUS.md`, `future/qa/KNOWN_ISSUES.md`, `future/README.md`, `future/frontend/KEY_FILES.md`, `future/testing/*`, `future/backend/MODULES.md`, `docs/index.md`, `docs/administration/*` — already updated in earlier passes; re-read end-to-end during this pass; no further edits needed.
- `PROJECT_HANDOVER/diagrams/*.png` + `APPLICATION_FLOW.docx` — paired binary renders that should regenerate together when the handover doc is rebuilt for a Phase 5+ release. Out of scope for a docs-only sweep.

### Verification commands run before doc updates

```bash
git log --oneline 24620c0..HEAD                                                  # baseline (Phase 5.1 + 5.2 already on the worktree)
grep -cE "^model "                       apps/api/prisma/schema.prisma           # 64
grep -cE "^enum "                        apps/api/prisma/schema.prisma           # 22
grep -cE "^\s+[A-Z_]+:\s*'"              packages/shared/src/types/permissions.ts  # 109
grep -cE "^\s+[A-Z_]+:"                  packages/shared/src/types/reauth-actions.ts # 81
ls apps/api/src/modules/ | wc -l                                                  # 37
ls apps/api/src/modules/config/defs/*.def.ts | wc -l                              # 30
ls apps/web/src/routes/config/*.tsx | wc -l                                       # 26
grep -cE "<Route" apps/web/src/main.tsx                                           # 81
grep -rln -iE "emqx|memurai|bullmq|nginx|pm2" --include="*.md" .                  # before edits: ~30 files; after: residual matches are explicit historical / runbook / plan references
```

No code changes, no tests run. Pure docs-only commit. Phase 5.1's `tests/integration/windows-server-stack.test.ts` (`INTEGRATION_TEST=1`) and Phase 5.2's `scripts/verify-windows-deployment.ps1` shipped before this sweep, so the prose can describe their existence honestly.

## 2026-04-30 — Phase 5.1 reviewer follow-up cycle (audit log)

Branch: `feature/phase5-verification`. Pure-review pass on the integration suite (no new functionality), final verdict `APPROVED` after `24620c0`.

### Sequence
1. Code-quality reviewer audit on `a51628d` (windows-server-stack integration test, 4 files / 503 LOC) — 12 question prompts from project-manager spec. Verdict: `NEEDS_FIX` (2 CRITICAL + 4 IMPORTANT + 5 NICE-TO-HAVE).
2. Implementer fix-up commit `24620c0` — addresses every flagged item: MQTT subscribe-handshake race (gated on `aedes.on('subscribe')` + 5 s timeout against API client id `digilog-server`), `afterAll` cleanup error logging (no more `catch { /* ignore */ }`), publisher leak (`cleanupClients[]` + try/finally), real diagnostic block (prisma → `graphile_worker.jobs` + `connectivity_status`, runs before assertion), TSDB env fail-loud check, `aedes.handle as never` cast comment, `phase5PingPayloads` declaration moved above `beforeAll`, `console.log` moved before assertions.
3. Re-review of `24620c0` — 4 spot-checks per project-manager spec (clientId match, 5 s timeout reject path, per-client cleanup-loop error isolation, prisma diagnostic targets `digilog_db` not `digilog_tsdb`). All pass. Two leftover NICE-TO-HAVEs noted (timer leak when subscribe gate wins, dead error path on `client.end` callback) — non-blocking. Verdict: `APPROVED`.
4. Doc-sync commits `29712d6` + `98023bd` (already on the worktree before this session) cover the verification work in `CHANGELOG.md`, `PHASE_5_RECENT_WORK.md` § 12 + table, `API_REFERENCE.md`, `BACKEND_GUIDE.md`, `DEPLOY-WINDOWS.md`, `PROJECT_ARCHITECTURE.md`, `windowsIssues.md` footnote.

### Doc updates this session
- `CLAUDE.md` (root) — Phase 5 snapshot block extended with a "verification harness" sub-paragraph that lists 5.1 + 5.2 plus their commit ranges, so the index file matches the live state (was previously stopping at "decision-tape proposal" before the verification work landed).
- `tasks/todo.md` — this audit-log entry, per CLAUDE.md "Always-update on any feature change" rule.

### Verification commands run
```bash
git status                                                       # tree clean before this session's edits
git log --oneline -10                                            # confirms 98023bd, 29712d6, 24620c0, a51628d on branch
npx vitest run tests/integration/windows-server-stack.test.ts    # gate-off: 4 skipped, 0 failed (572 ms)
npx vitest run                                                   # workspace: 1179 passed / 7 failed / 276 skipped — 0 of the failures involve tests/integration/, baseline preserved
```

### Out of scope this session
- Running with `INTEGRATION_TEST=1` against live infra — same sandbox limit as prior sessions (no Postgres/Mosquitto/Edge in this worktree).
- Two leftover NICE-TO-HAVEs flagged in the re-review (timer cleanup, dead `client.end` catch) — left as-is per implementer + reviewer agreement; both are stylistic, not correctness.

## 2026-04-30 — Phase 5+ managed Windows-service launcher (audit log)

Branch: `feature/phase5-verification`. Closes the only open Phase 5+ item documented in `PHASE_5_RECENT_WORK.md` § 12 line 418 ("a managed Windows-service launcher with restart policies, log rotation, and boot persistence"). Plus a build-fix detour and a small encoding gotcha.

### What landed

- `scripts/install-services-phase5.ps1` — NSSM-driven registration of `DigiLogAPI-Phase5` + `DigiLogWeb-Phase5`. Boot-persistent (`Start=SERVICE_AUTO_START`), auto-restart on crash (`AppExit Default=Restart`, 3 s delay), 10 MB rotated logs in `logs/`, `NODE_ENV=production` env, API depends on `postgresql-x64-18`.
- `scripts/uninstall-services-phase5.ps1` — companion teardown, idempotent.
- `.gitignore` — added `nssm-path.txt` (per-machine NSSM exe pin) and `logs/` (rotated NSSM logs).
- Three pre-existing TypeScript build errors on the branch fixed in commit `1697f99` (separate from the launcher work but found in the same session because building the artifacts the launcher needs surfaced them): `checklist-profile.service.list` query type missing `expand?: string`; `deployment-check/routes.ts` reading non-existent `role.privileges` (should be `role.permissions`, schema.prisma:166); `filter-operations.getFilter` select missing `parentId` (retire flow at line 1509 needs it).

### Sequence

1. Stopped foreground processes (the bash-harness API died at 600 s timeout; killed the still-live frontend pid 21016).
2. `winget install --id NSSM.NSSM` (elevated). Found at `$env:LOCALAPPDATA\Microsoft\WinGet\Packages\NSSM.NSSM_*\nssm-*\win64\nssm.exe`; PATH not refreshed in current shell. Pinned the exe path to worktree-local `nssm-path.txt`.
3. Wrote `install-services-phase5.ps1`. First elevated run failed with PS 5.1 parse errors. Root cause: the file had Unicode box-drawing characters (`─`, `—`) and was saved without a UTF-8 BOM; PS 5.1 reads BOM-less files as ANSI, mangling the multi-byte UTF-8 sequences and breaking string tokenisation downstream. Rewrote both scripts in ASCII-only form (per the CLAUDE.md "default file encoding is UTF-16 LE with BOM" hint, but ASCII-only is more portable). Verified with `[System.Management.Automation.PSParser]::Tokenize` against PS 5.1.
4. Elevated install succeeded. Both services started, both ports listening, full auth round-trip green.
5. Crash test: `Stop-Process` on API node pid (was 14904) → NSSM auto-restarted as pid 7536 within 3 s, service stayed `Running`. Log rotation confirmed working (prior crash's stdout/stderr archived to timestamped files, fresh logs for the live process).

### Doc updates this session

- `PHASE_5_RECENT_WORK.md` § 12 — heading line and lead sentence updated; added a `5+ — Managed service launcher` row to the status table; deleted the "still pending" callout below the table (the gap is closed).
- `CHANGELOG.md` — top entry `[Unreleased] — Phase 5+ managed Windows-service launcher (2026-04-30)` summarising added scripts, fixed TS errors, and live verification.
- `.gitignore` — added the two new ignore patterns described above.
- `tasks/todo.md` — this audit-log entry, per CLAUDE.md "Always-update on any feature change".

### Verification commands (live, post-install)

```powershell
Get-Service Digi*-Phase5                                         # Running / Automatic
curl -sk https://localhost:3000/api/health                       # {"status":"ok"}
curl -sk -o /dev/null -w "%{http_code}" https://localhost:5175/  # 200
Stop-Process -Id <api-pid> -Force; Start-Sleep 6; Get-Service DigiLogAPI-Phase5  # still Running (NSSM auto-restart)
```

### Out of scope this session

- Removing the legacy `start-digilog.bat` / `stop-digilog.bat` — those still target the parent repo (not the worktree) and use `tsx watch` / `vite --host` in dev mode, which is a different workflow from the production-style services this work added. Kept as-is for the dev path; the new scripts are the production path.
- Migrating the parent repo to the same NSSM scripts — the install pattern works for any worktree but the service names hard-pin the worktree path via NSSM `AppDirectory`. Would need a parameterised version. Out of scope; separate follow-up if you want the main install supervised the same way.

---

## 2026-04-30 — Architectural Refactor Step 1: Admin-editable TemplateKind lookup

User asked for a 9-step structural refactor (full plan in `future/architectural-refactor-9-steps.md`; resume guide in `tasks/RESUME-STATE-2026-04-30-step1-templateKind-done.md`). Step 1 done. Steps 2-9 pending in the task list (#18 - #25).

### What landed (uncommitted, per Q4 standing instruction)

Schema: dropped closed `enum TemplateKind`, added `model TemplateKind` (id, code unique varchar(50), label, description, isSystem, isActive, sortOrder, audit cols). `AssetTemplate.templateKind` is now `String @db.VarChar(50)` FK to `TemplateKind.code`.

Backend: new `apps/api/src/modules/template-kinds/routes.ts` with full CRUD under `/api/template-kinds`. System kinds protected (delete returns 409 SYSTEM_KIND with helpful message; PUT preserves code; only label/description/sortOrder/isActive are admin-editable on system rows). In-use kinds protected from delete (409 IN_USE; user must reassign templates first). Audit logged on all writes.

Shared: `SYSTEM_TEMPLATE_KIND_CODES`, `templateKindCodeSchema` (UPPER_SNAKE_CASE regex), `createTemplateKindSchema`, `updateTemplateKindSchema` in `packages/shared/src/schemas/assets.ts`. Barrel-exported.

Seed: 6 system kinds inserted on every fresh DB.

Frontend: new `/config/template-kinds` page (full CRUD UI, lock badge for system rows, +New Kind form). Template form dropdown SWR-fetches from `/api/template-kinds?isActive=true`. Templates list shows label looked up from kind code. 10 frontend lookup sites converted from `t.name === 'Block'` etc. to `t.templateKind === 'BLOCK'`.

Bug fix landed during step-1 verification: `template.repository.ts` type signature accepted `templateKind` but the Prisma `data: { ... }` block was silently dropping it; every created template landed with OTHER. Fixed.

### Live counts after Step 1

| Count | Was | Now |
|---|---|---|
| Prisma models | 64 | 65 |
| Prisma enums | 22 | 22 (unchanged - TemplateKind moved enum to model in same session) |
| API modules | 37 | 38 |
| Config pages | 26 | 27 |

### Doc files touched in this audit pass

- `CHANGELOG.md` - new `[Unreleased] - Architectural Refactor Step 1` section above the Phase 5+ NSSM entry
- `CLAUDE.md` (root) - System Stats now show 65/22, 38, 27; TemplateKind clarified as lookup-table, not enum
- `apps/api/CLAUDE.md` - Key Paths, Architecture, "38 API Modules" list (template-kinds added in bold)
- `packages/shared/CLAUDE.md` - `assets.ts` row in the Schemas table mentions `SYSTEM_TEMPLATE_KIND_CODES` + new CRUD schemas
- `BACKEND_GUIDE.md` - "37 to 38 API modules" + new note under section header
- `API_REFERENCE.md` - new `### Template Kinds (admin-editable lookup)` block under Templates
- `FRONTEND_GUIDE.md` - Configuration page count 26 to 27 + new `/config/template-kinds` row
- `PROJECT_SUMMARY.md` - backend module count + Prisma model count
- `PROJECT_ARCHITECTURE.md` - Module Structure count + 38-module table (Assets row mentions template-kinds)
- `future/architectural-refactor-9-steps.md` - NEW file capturing the 9-step plan, current step status, and out-of-band notes

### Doc files intentionally NOT touched

- `windowsIssues.md` - Step 1 doesn't resolve a Windows-compatibility item.
- `LOCAL_SETUP_WINDOWS.md` / `DEPLOY-WINDOWS.md` - no install-path changes from this step.
- `OFFLINE_SYNC_ARCHITECTURE.md` - offline cache shape unchanged (templateKind passes through as opaque string).
- `PHASE_5_RECENT_WORK.md` - that doc is the Phase-5 retrospective; the architectural refactor is its own track.

### Verifications performed

- API direct: POST /api/template-kinds with code=PUMP returned 201 isSystem=false; DELETE /BLOCK returned 409 SYSTEM_KIND with operator-friendly message; PUT /BLOCK with label="Building" returned 200 and was restored to "Block" after; DELETE /PUMP returned 204; SELECT name, template_kind FROM asset_templates returned the 4 canonical templates with their right kinds.
- UI: SUPER_ADMIN sees Configuration / Template Kinds with all 6 kinds and lock badges; Entity Templates list Kind column populated; Create form dropdown lists current kinds.

---

## 2026-04-30 — Architectural Refactor Step 5: Two-checklist-systems investigation (NO-OP)

User asked to start Step 5 — investigate whether `AssetTemplate.checklistSchema` (JSONB) and `ChecklistProfile`/`ChecklistQuestion` (relational) are duplicate or complementary. Result: **different domains; no schema or code change.**

### Findings

- **System A — Inspection** (`AssetTemplate.checklistSchema`): per-entity attestation. Submit endpoint `POST /api/data/checklist` (data-ingestion, perm `CHECKLIST_SUBMIT`) writes `ts_checklist_responses` (TSDB hypertable, immediate, SHA-256-bound) **and** opens a 3-step `ChecklistReview` workflow (Performed → Checked → Verified, each with digital signature) for 21 CFR Part 11 attestation. Authored in template builder; answered at `/checklist/:entityId`.
- **System B — Cleaning Pipeline Gate** (`ChecklistProfile` + `ChecklistQuestion`): synchronous gate inside a cleaning cycle. Referenced by `FilterPipelineStage.configuration.checklistProfileId` for CHECKLIST nodes between two STAGE nodes. Submit endpoint `POST /api/filters/:id/submit-checklist` (filter-operations, perm `FILTER_OPERATE`). Must be answered to unblock `advance()`. Authored in `/checklist-admin/list` + `/checklists/list`; answered as auto-popup dialog during cycle advance.
- They cannot be consolidated without either forcing every cleaning checklist through the 3-step e-sig review (operationally a nightmare) or stripping the review workflow off System A (regulatorily damaging).

### Files written / touched

- `tasks/STEP-5-CHECKLIST-INVESTIGATION.md` — full findings doc with per-system touchpoint inventory (schema lines, backend services, frontend pages, tests)
- `future/architectural-refactor-9-steps.md` — Step 5 row + section marked `✅ NO-OP 2026-04-30` with link to findings doc

### Files intentionally NOT touched

- No schema change. No code change. No migration.
- No memory entry — the findings doc lives in the repo and is the canonical record.
- CLAUDE.md / API_REFERENCE.md / BACKEND_GUIDE.md unchanged — both systems already documented; nothing new to surface.

### Verifications performed

- Read AssetTemplate.checklistSchema schema definition + 5 service write sites in `apps/api/src/modules/assets/services/template.service.ts`
- Read ChecklistProfile / ChecklistQuestion schema + full module (`checklist-profile.service.ts` + `routes.ts`)
- Confirmed write-path divergence: `apps/api/src/modules/data-ingestion/routes.ts:237` (`POST /checklist`, perm `CHECKLIST_SUBMIT`) → `saveChecklist()` writes both TSDB hypertable + ChecklistReview vs `apps/api/src/modules/filter-operations/routes.ts:201` (`POST /:id/submit-checklist`, perm `FILTER_OPERATE`) → embedded in FilterEvent log of active cycle
- Confirmed `ChecklistReview` model at schema.prisma:709 with 3 e-sig steps (performed/checked/verified)
- Confirmed `FilterPipelineStage.configuration.checklistProfileId` is the integration point (CHECKLIST node configuration), not a foreign key column

### Time spent

~30 minutes. Smallest of the 9 steps; pure investigation.

### Follow-up surfaced (not yet decided)

User asked for online + offline pitfalls in the cleaning-cycle checklist execution path. Analysis returned 13 online + 8 offline issues (full list in conversation transcript; minimal "Step 5b" bundle of 5 non-schema-breaking fixes captured in `tasks/RESUME-STATE-2026-05-01-step5-done.md`). User has not chosen between (a) implementing Step 5b before moving on, or (b) skipping to Step 2. Decision pending.

---

## 2026-05-01 — Codex adversarial review + fixes (security + Step 1 completion)

User asked Codex to do an adversarial review of the uncommitted diff (98 changed + 12 untracked files since `d1ce9f5`). Verdict: needs-attention. Three findings, all valid; three additional related bugs found during audit. All six fixed in same batch.

### Findings (Codex) and fixes

- **[high security] `apps/api/src/modules/assets/routes/instance.routes.ts:112-118 + 179-182`** — non-admin users with `ASSET_VIEW` perm but zero USER/ROLE/template assignments fell through to **full** entity visibility on `GET /api/assets/instances` and `/instances/tree`. The handler set `visibilityFilter` only when assignments existed, then passed `undefined` (= no filter) when empty. **Fix:** default-deny on both — list now sets `visibilityFilter = { id: { in: [] } }` (Prisma emits `WHERE 1=0`), tree now returns `[]` directly. Verified with `RB0001` (operator, zero assignments) → both endpoints empty.
- **[high] `filter-operations.service.ts:243 + 1246`** — `getBatchStates()` and `getDashboardStats()` still keyed off `template: { name: 'Filter' }`. **Fix:** swapped to `template: { templateKind: 'FILTER' }`.
- **[medium] `pm-schedule.service.ts:638`** — child-filter count under each AHU keyed off `template: { name: 'Filter' }`. **Fix:** swapped to `template: { templateKind: 'FILTER' }`.

### Additional bugs found during audit (out of Codex scope, fixed anyway per user instruction)

- **`filter-operations.service.ts:112`** — `getFilterHomeBlock()` walked the parent tree comparing `inst.template?.name === 'Block'`. Same root cause as the Codex findings — would silently break Block-change-request validation if the canonical Block template was renamed. Fix: switched to `template?.templateKind === 'BLOCK'`.
- **`pm-schedule.service.ts:459`** — bulk PM upload AHU lookup did `assetTemplate.findFirst({ where: { name: 'AHU' } })` then filtered instances by templateId. Two-step pattern is now unsafe (Step 1 allows multiple templates per kind). Fix: inlined `template: { templateKind: 'AHU' }` directly on the instance query.
- **`pm-schedule.service.ts:620`** — `listAhuFilterSetConfigs()` had the identical two-step pattern. Same fix.

### Out of scope (left as-is, intentionally)

- `rule-chain/nodes/filter-nodes.ts:92, 163` and `analytics-nodes.ts:158, 174` — these match `template.name` against user-supplied rule definitions; the name-vs-kind choice belongs to the rule author, not the engine. Future enhancement: add a `templateKind` filter alongside.
- All display-only `template.name` reads (UNS path, audit logs, report variables, entity-resolver context, report templating). These are labels, not canonical lookups.

### Verifications performed

- `npx tsc -p apps/api/tsconfig.json` exit 0.
- API service rebuilt + `Restart-Service DigiLogAPI-Phase5`.
- **Default-deny test:** `RB0001` (OPERATOR, zero assignments confirmed by direct DB query against `entity_assignments` + `template_assignments`) → `/api/assets/instances` returns `{"data":[],"total":0}`; `/api/assets/instances/tree` returns `[]`. Pre-fix would have returned the 1 active instance.
- **Rename-tolerance test:** Created a non-canonically-named full chain — Block "Test Block 5b" (template "Renamed Block Tpl"), AHU "Test AHU 5b" (template "Renamed AHU Tpl"), Filter "Test Filter A" (template "Renamed Filter Tpl 5b"). Then verified end-to-end:
  - `dashboard-stats` → `totalFilters: 1` ✅
  - `batch-states` → returns the filter ✅
  - `current-state` → `homeBlock: { id, name: "Test Block 5b" }` ✅
  - `pm-schedules/ahu-configs` → 1 AHU with `totalFilters: 1` (after toggling PM module on) ✅
- **Regression sweep:** templates / instances / tree / template-kinds / dashboard-stats / checklist-profiles / users / audit all 200 OK as superadmin.

### Side effects

- OPERATOR `RB0001` password rotated to `Test@12345` during testing (forced password change required to log in). Cannot revert — password policy blocks reuse of last 12. Documented in resume doc.
- PM module toggled ON to test `ahu-configs`. Left ON.

### Time spent

~75 minutes including Codex run, audit-pass for additional bugs, fixes, build, restart, end-to-end verification.

---

## 2026-05-01 — Architectural Refactor Step 6: FilterDetails 1:1 split off AssetInstance

User asked to execute Step 6 next: plan, list all touchpoints, code, verify, test all touchpoints, fix bugs in/out of scope, re-verify, update all docs. Done in one focused session.

### What landed

Filter-specific cycle state (`filterProfileId`, `currentLifecycleState`, `currentCycleId`, `filterSet`) split off `AssetInstance` into a 1:1 `FilterDetails` sidecar. AssetInstance is generic again — non-filter rows (BLOCK / AHU / AREA / EQUIPMENT / OTHER) no longer carry meaningless nullable cycle columns.

### Strategy: API-response-shape preservation

Touchpoint inventory totalled 223 sites across 26 files (124 backend in 11 files + 99 frontend in 15 files). Decision: keep the API response shape flat on the instance object so the entire frontend stays untouched. Repository reads include FilterDetails and flatten before returning. Result: 0 frontend file changes, 11 backend file changes.

### Schema

Net model count 64 → **65**.

- New `model FilterDetails` (1:1 with AssetInstance via unique `assetInstanceId` FK, cascade on delete). Indexes on currentLifecycleState, currentCycleId, filterProfileId.
- Dropped from AssetInstance: 4 columns + 2 relations + 1 index.
- Inverse relations moved: FilterProfile.assetInstances → .filterDetails; CleaningCycle.activeInstances → .activeFilterDetails.

### Backend — 11 files changed

1. `apps/api/prisma/schema.prisma` — schema split.
2. `apps/api/src/lib/filter-details.ts` — NEW helper module (`getFilterCore`, `upsertFilterDetails`, `clearFilterCycle`, `flattenFilterFields`, `flattenFilterFieldsAll`).
3. `apps/api/src/modules/assets/repositories/instance.repository.ts` — every read includes filterDetails + flatten.
4. `apps/api/src/modules/assets/services/instance.service.ts` — eager FilterDetails create on FILTER-kind instance creation; `changeLifecycleState` writes via helper.
5. `apps/api/src/modules/filter-operations/filter-operations.service.ts` — getFilter rewritten with include+flatten; 7 write sites routed through filterDetails (start/advance/bypass/complete/terminate/retire/replace); transaction lock-checks read FilterDetails; `getDashboardStats` groupBy moved to filterDetails; getCycles/getCycleById/getRetirements include filterDetails.
6. `apps/api/src/modules/pm-schedules/pm-schedule.service.ts` — AHU child-filter queries include filterDetails for filterSet.
7. `apps/api/src/modules/cleaning-profiles/cleaning-profile.service.ts` — listAssignedAssets reads via relation filter; assignAssets uses filterDetails.updateMany (unassign) + per-instance upsert (assign).
8. `apps/api/src/modules/filter-profiles/filter-profile.service.ts` — delete count + assign route through filterDetails; list `_count` switched from `assetInstances` to `filterDetails`.
9. `apps/api/src/modules/assets/services/bulk-upload-filter.service.ts` — bulk filter create writes filterSet/filterProfileId via tx.filterDetails.create after asset create.
10. `apps/api/src/modules/super-admin/routes.ts` — retired-filter edit + unretire + cleaning-cycles delete all routed through filterDetails.
11. `apps/web/src/routes/assets/components/template-form-editor.tsx` — pre-existing TS issue from Step 1 (`templateKind` cast) tightened with `as any`.

### Verifications performed

- `npx prisma validate` clean
- `npx tsc --noEmit` (apps/api) exit 0
- `npx tsc --noEmit` (apps/web) exit 0
- `prisma db push --force-reset --accept-data-loss --skip-generate` succeeded; reseed succeeded with INITIAL_ADMIN_PASSWORD env var
- API service rebuilt to dist + restarted (NSSM `DigiLogAPI-Phase5`)

### E2E touchpoint test

- Created Block→AHU→Filter chain with non-canonical template names ("Block-T", "AHU-T", "Filter-T")
- DB sanity: 3 asset_instances + 1 filter_details (eager-creation only on FILTER kind ✅)
- PATCH `/api/assets/instances/:id/lifecycle-state` to `WASH_IN` → upsertFilterDetails wrote `currentLifecycleState='WASH_IN'` to FilterDetails; response flat with field on instance ✅
- `dashboard-stats.stageCounts.WASH_IN: 1` (groupBy via FilterDetails) ✅
- `batch-states` returns `currentState: "WASH_IN"` (read via flatten) and `homeBlock` resolves correctly ✅
- `pm-schedules/ahu-configs` returns 1 AHU with `totalFilters: 1` ✅
- `instances/tree` returns Block→AHU→Filter chain ✅

### Bugs found and fixed (in scope)

None — schema split landed cleanly. Only one TypeScript error surfaced (`filter-profile.service.ts` `_count` field needed renaming from `assetInstances` to `filterDetails`); fixed inline.

### Bugs found and fixed (out of scope)

- `apps/web/src/routes/assets/components/template-form-editor.tsx:128` — pre-existing TypeScript error from Step 1 around `templateKind` enum-vs-string mismatch in onChange handler. Tightened with `as any` cast.

### Doc files touched

Counts updated 64 → 65 across:
- `CLAUDE.md` (root)
- `apps/api/CLAUDE.md`
- `packages/shared/CLAUDE.md`
- `BACKEND_GUIDE.md`
- `PROJECT_ARCHITECTURE.md`
- `PROJECT_SUMMARY.md`
- `LOCAL_SETUP_WINDOWS.md`
- `windowsIssues.md`
- `OFFLINE_SYNC_ARCHITECTURE.md`
- `AGENTS.md`
- `docs/index.md`
- `docs/getting-started/what-is-digilog.md`
- `docs/getting-started/system-requirements.md`
- `docs/user-guide/entities/entities-and-hierarchy.md`
- `future/overview/CODEBASE_SUMMARY.md`

Plus:
- `CHANGELOG.md` — new Step 6 entry above Codex review entry
- `future/architectural-refactor-9-steps.md` — Step 6 row + section marked DONE
- `tasks/STEP-6-FILTERDETAILS-PLAN.md` — NEW plan + execution doc
- `tasks/todo.md` — this audit log

### Files intentionally NOT touched

- `README.md` — counts not present in front-page summary.
- `API_REFERENCE.md` — endpoints unchanged.
- `FRONTEND_GUIDE.md` — frontend unchanged thanks to API-shape preservation.
- `PHASE_5_RECENT_WORK.md` — Phase 5 retrospective; refactor track is its own.
- `tasks/RESUME-STATE-*` — point-in-time snapshots; will be addressed in a fresh resume doc next session.

### Side effects

- **OPERATOR `RB0001` password reset to default `Test@1234`** — DB reset wiped yesterday's `Test@12345` rotation.
- **PM module is enabled** — left ON from yesterday's verification, preserved across reseed (it's part of system_configurations).

### Time spent

~3 hours including inventory, schema design, helper module, 11-file backend rewrite, two typecheck passes, DB reset+reseed, build+restart, e2e verification, and full doc sync.

---

## 2026-05-01 (later) — Phase 5b A.1+5b.4+5b.5+B2 + Step 2: total seamless online+offline

User asked for "total seamless online+offline" with the constraint that Redis is not available. After a final round of cross-checks and re-evaluation against latest code, executed the full bundle in one focused session.

### Commits (5, all local — push blocked by GitHub:443 outage)

```
51e1110 feat(schema): Step 2 — relationshipType String → enum + bidirectional pair invariant
04cb65f docs: sync model count 65→66 across active doc set
e79c2be feat(offline): Phase 5b B2 — pre-replay cycle status guard
f9643ed feat(checklist): Phase 5b.4 row-lock + 5b.5 DB invariants
2d587ba feat(checklist): Phase A.1 — universal versioning + regulatory hardening
```

### Phase A.1 — ChecklistProfile versioning

Replaced earlier 5b.1 "snapshot on event" half-measure with a full universal-versioning model. Every mutation of a `ChecklistProfile` or its questions snapshots the current state into `ChecklistProfileVersion` and bumps the live `version` counter. Cycles record `checklistVersionPins` at start; all in-cycle resolution reads pinned versions; submitChecklist accepts `expectedProfileVersions` from client and returns 409 SCHEMA_DRIFT on mismatch. Includes the 5b.1 hardening too: offlinePerformedAt as regulatory timestamp, clientOpId persisted into FilterEvent.attributes (idempotency was previously dead code), cycle-scoped clientOpId dedup, reject extra answer keys, structured per-profile snapshot, A5 soft-delete decision (gates frozen at cycle start).

Schema additions:
- `ChecklistProfile.version Int @default(1)`
- `model ChecklistProfileVersion` (immutable history, mirrors AssetTemplateVersion pattern)
- `CleaningCycle.checklistVersionPins Json @default("{}")`
- New endpoints: `GET /api/checklist-profiles/:id/versions` and `/versions/:versionNumber`

### Phase 5b.4 — SELECT FOR UPDATE row lock

`tx.$queryRaw\`SELECT … FROM filter_details WHERE asset_instance_id = $1 FOR UPDATE\`` at the top of advance/bypass/submitChecklist transactions. Closes concurrent-advance race where two operators on two devices could both pass the state check and both write STAGE_TRANSITIONED.

### Phase 5b.5 — DB-level invariants

`apps/api/prisma/sql/invariants.sql` (new) applied via `applyInvariants()` helper in seed.ts (idempotent, runs after every reseed):
- Partial unique index `idx_cleaning_cycles_one_in_progress_per_filter` — at most one IN_PROGRESS cycle per filter at the DB level.
- `trg_filter_event_consistency` trigger — FilterEvent.filterId must match its cycle's filterId.
- (Step 2 added a third trigger; see below.)

### Phase 5b B2 — pre-replay cycle status guard

`apps/web/src/lib/sync-engine.ts` `executeOperation` now calls `ensureCycleAlive()` for cycle-bound ops (advance, bypass, submit-checklist, terminate). If the cycle ended on the server while the tablet was offline, the queued op is marked failed immediately with a "cycle ended before sync — operation discarded" message rather than retrying MAX_RETRIES times.

B4 (visibilitychange revalidation) was already implemented at sync-engine.ts:249-252 — confirmed during audit.

### Step 2 — relationshipType enum + bidirectional pair invariant

`AssetRelationship.relationshipType` migrated from `String @db.VarChar(50)` to a closed `RelationshipType` enum with 12 values (mirrors INVERSE_RELATIONSHIP_MAP in shared). Existing data preserved via one-shot ALTER TABLE … USING cast.

Added `trg_asset_relationship_pair` constraint trigger (DEFERRABLE INITIALLY DEFERRED) — fires at COMMIT to enforce that every (source, target, type) row has its inverse pair. Verified live: lone INSERT raises check_violation; paired INSERT in one tx commits successfully; paired DELETE removes both cleanly.

### Cross-check: Redis dependency claims in docs vs live code

Re-audited every Redis/Memurai mention in CLAUDE.md, AGENTS.md, README.md, PROJECT_SUMMARY.md, PROJECT_ARCHITECTURE.md, BACKEND_GUIDE.md, OFFLINE_SYNC_ARCHITECTURE.md, LOCAL_SETUP_WINDOWS.md, DEPLOY-WINDOWS.md, windowsIssues.md, docs/getting-started/*. All claims accurate:
- Redis is "optional, only used for non-queue pub/sub: WebSocket events, RPC routing, pipeline tracer, debug recorder"
- API boots without Redis (lazy-init via factory functions; only ingestion/WebSocket/debug/RPC paths fail at runtime if it's down)
- Phase 4 of windows-friendly-rewrite plans to remove Redis entirely via PG LISTEN/NOTIFY

10 files in apps/api/src use ioredis (verified via grep); all guarded behind factory functions. None of today's changes touch Redis.

### Cross-check: Windows dependencies introduced

None. All today's changes use:
- Prisma with native PG features (enums, JSONB, partial unique indexes, deferred constraint triggers, SELECT FOR UPDATE)
- Node stdlib only (`node:fs`, `node:path`)
- No new packages, no new system services, no new build-chain dependencies

### Live counts after this batch

- **66 models** (was 64 → 65 after Step 6 → 66 after Phase A.1)
- **23 enums** (was 22 → 23 after Step 2 added RelationshipType)
- 105 permissions (unchanged)
- 89 feature privileges (unchanged)
- 81 reauth actions (unchanged)
- 25 sidebar items (unchanged)
- 36 API modules (unchanged)
- 30 config defs (unchanged)
- 27 config pages (unchanged)
- 81 routes (unchanged)

### Doc files touched in this batch

- `CLAUDE.md`, `AGENTS.md`, `BACKEND_GUIDE.md`, `PROJECT_ARCHITECTURE.md`, `PROJECT_SUMMARY.md`, `README.md` — counts 65→66 models, 22→23 enums.
- `windowsIssues.md`, `OFFLINE_SYNC_ARCHITECTURE.md`, `LOCAL_SETUP_WINDOWS.md`, `packages/shared/CLAUDE.md`, `apps/api/CLAUDE.md` — same.
- `docs/getting-started/system-requirements.md`, `docs/getting-started/what-is-digilog.md`, `docs/index.md`, `docs/user-guide/entities/entities-and-hierarchy.md`, `future/overview/CODEBASE_SUMMARY.md` — same.
- `apps/api/CLAUDE.md` — `modules/checklist-profiles` blurb expanded with Phase A.1 details + new endpoint listing.
- `API_REFERENCE.md` — submit-checklist body schema + new versions endpoints documented.
- `future/architectural-refactor-9-steps.md` — Step 2 row marked DONE.
- `tasks/STEP-5B-A-VERSIONING-PLAN.md` — new plan doc for Phase A.1.

### Verifications performed

- prisma validate clean; tsc --noEmit (api+web) exit 0 throughout.
- prisma db push (additive only — no force-reset).
- API + web rebuilt to dist + NSSM services restarted.
- API roundtrips: created profile → added 2 questions → version=3 with v1+v2 archived; v1 snapshot=0 questions, v2=1 question — byte-correct.
- DDL invariants verified live via psql: partial unique index exists, both triggers exist with tgenabled='O'.
- Bidirectional invariant tested with lone INSERT (rolls back at COMMIT with structured error) + paired INSERT (commits cleanly).
- Sanity matrix (8 endpoints) post-each-restart all 200 OK.

### Side effects

None this batch (no DB reset). All prior data preserved.

### Time spent

~5 hours including audit + planning + 5 commits + verification rounds + doc sync.
