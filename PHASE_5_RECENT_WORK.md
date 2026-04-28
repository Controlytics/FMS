# Phase 5 — Reports, Offline Hardening, RFID SDK, Filter Data Console (April 15–29, 2026)

This doc captures the architecture and behavior changes that landed **after** the Phase 4 release (`2.3.0`, 2026-04-14). Everything here is live in the working tree on branch `RFID`. CHANGELOG entries `2.4.0` and `2.5.0` summarize the same work in release-note form; this doc focuses on the *why* and the cross-cutting design decisions.

---

## 1. Reports Module (phases A–F complete)

Server-side report generation engine that resolves variable tags, renders HTML with charts, converts to PDF via Puppeteer, and serves downloadable reports.

### Schema + permissions
- **4 Prisma models**: `ReportTemplate`, `ReportTemplateVersion`, `ReportInstance`, `ReportSignature`
- **2 enums**: `ReportTemplateStatus`, `ReportStatus`
- **9 `REPORT_*` permissions**, **6 reauth actions**, **2 sidebar items** (`report-templates`, `reports`)
- **Status workflow**: `DRAFT → PENDING_SIGNATURE → SIGNED / REJECTED`
- **Storage**: PDFs at `uploads/reports/`, metadata in `ReportInstance` table

### Architecture
Single synchronous request-response pipeline:

```
parse template config
  → resolve {{tags}} via 5 data sources
    → build HTML with Handlebars
      → render charts as base64 PNG (chartjs-node-canvas)
        → generate PDF via Puppeteer
          → store to disk
            → return report instance
```

### Code structure
```
apps/api/src/modules/reports/
  report.service.ts          — orchestrator: generate, list, get, delete
  report.routes.ts           — 6 API endpoints
  variable-resolver.ts       — parse {{tags}}, dispatch to data sources
  data-sources/
    attribute-source.ts      — attr.$slot.field
    identifier-source.ts     — ident.$slot.type
    telemetry-source.ts      — ts.$slot.key[modifier]
    timestamp-source.ts      — time.now, time.range.*
    meta-source.ts           — meta.report/user/org.*
  renderers/
    html-builder.ts          — full HTML document
    chart-renderer.ts        — chartjs-node-canvas → base64 PNG
    pdf-renderer.ts          — Puppeteer HTML → PDF Buffer
    styles.ts                — CSS for PDF print layout
```

### Key behaviors
- **Visual template designer** — drag-and-drop layout editor with header / footer / section blocks
- **5 variable data sources** — attribute / identifier / telemetry / timestamp / meta
- **Digital signatures** — reports can be signed at generation time; signature metadata embedded in PDF + report instance
- **Synchronous generation** — single request-response (no BullMQ pipeline yet)
- **Frontend pages** — template list, template editor, report instance list, report viewer

Original design plan: `old/docs-superseded/superpowers-plans/2026-04-15-report-template-designer.md` and `2026-04-15-report-generation-engine.md`.

---

## 2. Offline Hardening — 14-issue overhaul

The Phase 3 offline implementation reconstructed pipeline logic client-side, leading to drift bugs. Phase 5 replaced the entire approach with **cache server responses verbatim, replay them via idempotent ops**.

### Foundation (commit `3c99973`)
- **TTL-based cache invalidation** — every cache entry has an explicit `expiresAt`; readers respect it
- **Idempotency keys** — every queued op carries `op-{uuid}`; server dedupes replays
- **Tombstones** — locally-deleted entities tracked separately so replay doesn't resurrect them
- **LRU eviction** — bounded cache size; oldest entries dropped on overflow
- **JWT refresh during replay** — queued ops can outlive their original token; replay path acquires a fresh token before retry

### In-code overhaul (commit `0c8de53`)
- **Stale-profile guard** — replay refuses to apply ops against a profile version that has changed; surfaces a yellow banner ("This filter's cleaning profile has changed since this cycle started") when `cycle.profile_id != live block-assignment`
- **Pre-cache on login** — full master-data hydration as soon as the user is authenticated (not lazy). Cached: cleaning-profile-assignment, active profiles, branding, field-ids, my-reauth-actions, approved block-change requests
- **Server-side `stageLookup`** — pre-computed per-stage `{nextStages, pendingChecklistProfileIds, leadsToEnd}` on `/current-state` response, so client doesn't need to walk the graph. Was: client walked the graph and missed chained CHECKLIST nodes (e.g. `WASH_IN → CHECKLIST_A → CHECKLIST_B → WASH_OUT` only saw `CHECKLIST_A`)
- **Filter-state cache TTL** raised 30 min → 24 h so long offline shifts don't invalidate cached cycle state

### Capacitor + APK (commit `b8e003e`)
- **Capacitor Network plugin** — replaces unreliable `navigator.onLine` on Android WebView
- **Service Worker hook** — backgrounded tab still triggers sync engine when device comes back online via SW `sync` event
- **APK rebuild** with the SW + Network plugin baked in

### Why this matters
Memory `feedback_offline_design.md` codifies the lesson: *never reconstruct server logic client-side*. The new architecture caches the full server response per filter (`filter-state-{id}`) and replays exact-state semantics. See `OFFLINE_SYNC_ARCHITECTURE.md` for the full design.

---

## 3. RFID SDK Plugin in DigiLog APK (commit `39ccd1c`)

Before: KC-series UHF readers worked only via the standalone `rfid_scan_app/` Kotlin app (UKB-mode keyboard burst into the main APK).

After: `apps/android/android/app/src/main/java/.../RfidPlugin.java` wraps `Reader_Usb.jar` and exposes a Capacitor plugin to the web app. The DigiLog APK now supports **both** modes:

- **SDK mode** — direct USB SDK calls; works regardless of focused input
- **UKB mode** — keyboard-emulation fallback (with web-side guard via `use-rfid-guard.ts`)

UKB mode also fixed:
- **Zero-delay live tag display** — every keystroke now goes straight to the input (commits `bc8df22`, `f9721af`, `fd046fe`)
- **Burst threshold raised to 150 ms** — accommodates slower readers
- **On-screen debug overlay** for tag-scanning issues

---

## 4. Filter Data Management Console — 10 tabs mirror user pages

The data-management console at `/data/filters/:id` exposes filter-related rows from every relevant table. Phase 5 redesign principle: **each tab must render like its user-facing page**, not raw DB rows.

| Tab | Mirrors | Key columns |
|---|---|---|
| Retirements | `/filter-management/retirement` | retirement reason, date, performer |
| Replacements | `/filter-management/replacement` | replaced filter, replacement filter, date |
| Cleaning Cycles | `/cleaning-cycles/history` | profile, stage, status, performer |
| Filter Events | `/filter-traceability/:id` | event type, timestamp, performer, payload |
| Alarms | `/alarms` | severity, threshold, value |
| PM Entries | `/pm-schedules/:id` (detail card grid) | scheduled date, tolerance window, status |
| Audit Trail | `/audit` | actor, action, before/after diff |
| Notifications | `/notifications` | channel, status, payload |
| Admin Requests | `/admin-requests` | requester, type, status |
| Block Changes | `/approvals` | from-block, to-block, status |

### ⚠️ Compliance note (Super Admin escape hatch)
The Filter Data Mgmt console at `/config/filter-data-management` is a **SUPER_ADMIN-only** raw-edit surface:
- **All columns are inline-editable**, every record is deletable
- **Zero audit trail** — edits/deletes through this console produce **no audit entries** (deliberate; for emergency data fixes)
- **Unretire flow** — `_preRetireParentId` saved in `customAttributes` during retirement; unretire restores original parent AHU + deletes the replacement filter + removes all traces
- This bypasses the 21 CFR Part 11 audit-chain on purpose; access must be restricted to break-glass admins only.

Each tab also has an **Edit modal** matching the user-facing page's edit dialog.

Captured by memory `feedback_filter_data_mgmt_mirrors_pages.md`.

---

## 5. DRY_IN Two-Step Flow

DRY_IN was a single-event stage. Phase 5 split it into two steps for proper UX:

```
DRY_IN entry
  → SET_DURATION    — operator picks dryer minutes; cycle stays at DRY_IN
    → countdown panel renders (web + tablet + offline)
      → SUBMIT_READINGS — operator records temperature; cycle advances to DRY_OUT
```

### Implementation notes
- "Currently Drying" panel reads `dryerStartedAt` + `dryerDurationMinutes` from `filter-state-{id}` cache → renders even if the user navigates away and comes back, online or offline
- Selected-but-unsubmitted temperature persists in `dryer-temp-{id}` cache key
- Offline replay: server enforces SET_DURATION → SUBMIT_READINGS ordering; replay tolerates them as separate idempotent ops
- Cleaning-cycle history reads `dryerTemp` from the readings event for display

Original design plan: `old/docs-superseded/superpowers-plans/2026-04-17-dryin-state-persistence.md`.

---

## 6. Dynamic Backup / Restore

Old: explicitly-listed table names + manual JOIN code in the backup module. New entries to the schema were silently missed.

New (commit `15619be` / earlier): **iterate `pg_tables`** to enumerate every table, **`jsonb_populate_recordset`** to round-trip rows generically. Result:

- All **64 tables** covered automatically when a new model is added
- **Non-superuser compatible** — no `pg_dump` shell-out
- **Two-pass fixup for self-referencing rows** — first pass inserts with NULL self-refs, second pass updates them
- **SQL / CSV / JSON formats** all roundtrip `password_hash` (was previously stripped)

Captured by memory `project_dynamic_backup.md`.

---

## 7. Bloat Audit + Code Reorg (April 20–21)

`old/docs-superseded/bloat.md` is the full audit. Resolved in commits `15619be` / `8e9f244` / `251be95`:

- **P0.1 Submit-path parity** — extracted `validateAndQueue` helper; deleted ~200 LOC duplicate validation in `mobile-operations.tsx`
- **P0.3 `as any` budget** — lint rule blocks new occurrences; existing list shrunk
- **P1.1 Inline-style codemod** — added theme utility classes (`.text-theme-primary`, `.bg-theme-gradient`, etc.); replaced ~200 `style={{...}}` attributes
- **P2.3 Config monolith split** — `config/routes.ts` (1003 LOC, 40 endpoints) split into per-tab files
- **P2.4 Rotted comments removed** — `// removed: RolePrivilegesPage`, `// removed: SidebarConfigPage`
- **P3.1 Dependency drift fixed** — moved `jspdf`, `sanitize-html` to correct workspaces; removed dead `html5-qrcode`
- **EC2 / PM2 / Linux assets removed** — app is local-Windows-only; reduces drift between docs and reality

Outstanding from bloat.md (2 / 14): P0.2 monster-file split for `filter-list.tsx` (2433 LOC) and `rule-chains/editor.tsx` (2140 LOC).

---

## 8. Decision Tape Proposal (future architecture)

Captured by memory `project_decision_tape_proposal.md`. Goal: kill the recurring class of client/server pipeline drift bugs.

### Idea
Server emits an ordered "action tape" per filter — a sequence of permitted next actions with their parameters and validation rules. The client has **zero pipeline logic** — it just renders the tape and queues actions back.

```
GET /api/filters/:id/current-state
  → returns { state, actions: [{type, params, validations, ...}] }
  → tablet renders buttons/dialogs from `actions`
  → tablet POSTs back the chosen action; server validates against the same tape
```

### Benefits
- Pipeline rules live in **one place** (server)
- Replay is simply "did the action match a valid entry in the tape we cached?"
- Adding a new pipeline node type does not require a tablet release

### Status
Proposal only — not implemented. Current implementation still computes a `nextStages` array client-side (with `stageLookup` resolving the chain server-side as a stopgap).

---

## 9. Other Phase 5 work

### Filter CRUD + hierarchy edit/delete (session 04-18)
- **5 new permissions**: `FILTER_CREATE`, `FILTER_EDIT`, `FILTER_DELETE`, `FILTER_HIERARCHY_EDIT`, `FILTER_HIERARCHY_DELETE`
- **5 new reauth actions**: `CREATE_FILTER`, `EDIT_FILTER`, `DELETE_FILTER`, `EDIT_HIERARCHY_NODE`, `DELETE_HIERARCHY_NODE`
- "Create Filter" dialog next to "Bulk Upload"; Edit / Delete icons on filter rows; hover-reveal Edit / Delete on AHU + Area nodes in the hierarchy diagram
- **Block deletion** — Delete button on filter-list block cards (`ASSET_DELETE` + `DELETE_ASSET` reauth)

### Tablet access matrix (session 04-18)
- New SUPER_ADMIN-only config `/config/access-matrix` — per-module role allowlist; modules without an entry default to visible (back-compat)
- New tablet feature `rfid_assign` in `/config/tablet-access` — search/select filter, view tags with Remove, scan/type new tag, Assign Tag
- Mobile login enforces tablet-access feature list; rejects roles whose allowed list is non-empty but doesn't include `login`

### Backend RBAC plumbing (session 04-18)
- **`app.requireAnyPermission(...perms)`** decorator — accepts any of the listed perms with `_MANAGE`/`_VIEW→_READ` fallbacks
- **`enforceReauth(action, req, reply)`** extended to accept `string | string[]` — reauth if any configured for role
- Wired across granular toggles: equipment-groups, checklist-profiles, cleaning-profiles, PM schedules, filter ops, asset identifiers, bulk-upload

### Compliance + security hardening (sessions 04-20, 04-25)
- **Skip Block removed** for stages with `needsBlock: true` (WASH_IN, DRY_IN) — was setting `selectedBlock.id = null` and silently bypassing all block-change approval logic
- **Notification ownership check** — `assertNotificationVisible()` on mark-read / mark-unread / delete (was: any user could mutate any notification)
- **`enforceReauth('UPDATE_EMAIL_CONFIG' / 'UPDATE_SMS_CONFIG')`** added to notification-delivery routes
- **Org scoping on `getEvents` / `getCycles`** when `filterId` not specified — closes cross-tenant read leak for non-admin roles
- **Instrument readings stored with `leastCount`** so historical PDFs format numbers forever at the right precision

### Config cleanup (session 04-20)
- **4 dead config defs removed** — `offline-sync`, `rfid-scanner`, `role-privileges`, `sidebar-config`
- `cleanupDeadConfigKeys()` migration in `config-discovery.ts` removes stale DB rows on next API start
- Two nav cards removed from `config/index.tsx`
- **Merged `pm-schedule-settings` + `filter-pm-schedule`** — config-discovery one-time migration copies the old `enabled` into the merged config and deletes the old row

### UI / formatting polish (session 04-20)
- **Least-count number formatting** — `apps/web/src/lib/format-by-least-count.ts`: integer LC → `25`, 0.1 → `25.0`, 0.01 → `25.00`. Applied everywhere instrument readings render
- Login app-name gradient now uses `backgroundImage` + explicit `backgroundClip: text` (the shorthand `background` was wiping the clip)
- Dashboard welcome + stat-cards + quick-actions now use `var(--theme-gradient-from/to)` and `var(--theme-primary)` / `var(--theme-accent)`
- Equipment Groups save toast, Help content pre-fetch on edit, dynamic-config empty-dropdown label, AHU dashboard truncation warning at >1000 filters
- Dashboard-cards backend validation rejects unknown card keys with 400

### Folder renames (session 04-21, P1.4 from bloat audit)
- `routes/checklist/` → `routes/checklist-form/` (end-user submission)
- `routes/checklists/` → `routes/checklist-admin/` (admin CRUD for templates)
- URL routes unchanged; only import paths differ

### Handover artifacts (session 04-20)
- `PROJECT_HANDOVER/APPLICATION_FLOW.md` — concise overview with 14 Mermaid diagrams
- `PROJECT_HANDOVER/APPLICATION_FLOW.docx` — detailed Word doc
- `PROJECT_HANDOVER/APPLICATION_FLOW_OVERVIEW.docx` — summary
- `PROJECT_HANDOVER/convert-to-docx.mjs` regenerates docx from md (uses pandoc + `@mermaid-js/mermaid-cli`)

### CWH stuck cycles fix (session 04-25)
- 7 IN_PROGRESS cycles bound to obsolete `test` profile terminated via `scripts/reset-cwh-cycles.sql` (status=TERMINATED + asset_instances cleared)

### PM QA Approval Workflow (session 04-13)
- Upload → entries land in `PENDING` state (SUPER_ADMIN auto-approves on upload)
- QA approves/rejects per-entry with mandatory remarks
- Rejected → user edits inline + resubmits
- Edit-after-approval → pending edit fields stored, old values stay active until QA re-approves
- `getDueTasks` only returns `APPROVED` entries — rejected/pending entries do not surface as due
- Schema: `PmEntryApprovalStatus` enum + 11 new columns on `PmScheduleEntry`
- New permission `PM_APPROVE`
- Config: `pm-schedule-approval` def with configurable `approvalRole`

### PM My Tasks system (session 04-11, hardened 04-13)
- CSV / XLSX bulk upload on PM Schedules page; rows = `(ahu_name, scheduled_date, tolerance_days)`
- **Past-date validation** (CSV only) — amber popup listing affected AHUs; user must click "Proceed Anyway"
- `GET /api/pm-schedules/due` returns entries in tolerance window + 30-day overdue horizon
- Desktop My Tasks at `/my-tasks`; Mobile My Tasks as a view inside `/m`
- **Per-AHU filter-set mode** (`/config/ahu-filter-set-config`) — 4 modes: `BOTH`, `SET_A`, `SET_B`, `DISABLED`; null `filterSet` filters included in BOTH only
- **PM auto-reason on mobile** — wash-in skips reason dialog when AHU has active PM window; `/current-state` returns `isPmDue` + `pmReasonKey`
- 21/21 audit tests passed (PM Schedules 7/7, Block Change 7/7, Filter Count 7/7) on 2026-04-13

### Visual Hierarchy Tree (session 04-13)
- Filters page List/Tree toggle
- Tree shows `Block → Area → AHU → Filter` with CSS connector lines
- Expandable/collapsible at each level
- Create buttons: `New Block`, `Add Area`, `Add AHU`
- Hover-reveal Edit / Delete on AHU + Area nodes (added 04-18)
- Create dialog renders dynamic fields from template `attributeSchema` (per `feedback_dynamic_template_fields`)
- Area template activated in DB

### RFID Tag Management on Filters Page (session 04-13)
- New RFID Tag column in the filter table
- RFID action button in each row's actions column
- Slide panel: view assigned tags, unassign, scan / type new tag
- `data-rfid="true"` attribute on the tag input — works with `use-rfid-guard.ts`
- Permissions: `ASSET_IDENTIFIER_CREATE` / `ASSET_IDENTIFIER_DELETE` (category: "RFID & Identifiers")

### Block Change Approval — implementation details (session 04-10..13)
- Trigger: filter belongs to Block A, user tries to clean in Block B → `/api/filters/:id/current-state?cleaningAreaId=B` returns `blockChangeStatus: 'REQUIRED'`
- Both desktop (`filter-operations.tsx`) and mobile (`mobile-operations.tsx`) show a "Request Block Change / Cancel" popup upfront
- Approved requests are **single-use**: status `APPROVED → EXPIRED` on cycle start
- Backend `AppError` sends `BLOCK_CHANGE_REQUIRED` (409) with structured `details: { filterId, homeBlockId, homeBlockName, requestedBlockId, requestedBlockName }`
- **Critical wiring**: `api-client.ts` line 58 maps `err.details ?? err.connectionInfo` — without this fix the popup never appeared
- Mobile approvals view requires comment input (added 04-13); remarks mandatory on all approval screens

### Configuration page restructure (session 04-13)
- General Settings (all admins): Password, DateTime, Backup
- Super Admin Settings: 22+ cards including new ones — RFID Scanner *(later removed as dead config)*, Offline Sync *(later removed as dead config)*, Cleaning Reasons, PM Schedule Settings, PM Schedule Approval, Block Change Approval, Filter Data Management, Tablet Access, Access Matrix, AHU Filter Set, Alarm Columns, Audit Templates, Cleaning Profile Assignment, Role Access
- Dynamic config modules section also SUPER_ADMIN-only

### Smaller items
- Forgot-password flow + show/hide password + lockout-progress UI on tablet (`a5fc98f`)
- Admin requests approval execution — approvals actually create/unlock/reset/modify users; requester Employee ID required; UUIDs hidden in audit (memory `project_admin_requests_flow`)
- Block-change request lifecycle — cross-block approval popup (desktop + mobile); single-use consumption; remarks mandatory (memory `project_block_change_approval`)
- PM "My Tasks" v1 — CSV bulk upload, `/api/pm-schedules/due`, expandable AHU cards, filter-set modes (memory `project_pm_my_tasks`)
- Capacitor online detection — poll `/api/health` every 15 s + on `visibilitychange` (memory `feedback_capacitor_online_detection`)
- className codemod merge rule — when replacing inline-style with className, merge into existing className attribute (memory `feedback_codemod_className_merge`)
- DateTime format support — DD-MM-YYYY in PM upload; PM upload upserts (no duplicates); admin-requests theme migrated indigo→cyan; bat-file errorlevel syntax fixed

---

## 10. Where to find historical design rationale

The completed feature plans live in `old/docs-superseded/superpowers-{plans,specs}/`. They contain problem statements, data models, validation logic, and API contract decisions that **are not duplicated in the code or CHANGELOG**:

| Feature | Spec / Plan |
|---|---|
| Block change approval | `superpowers-specs/2026-04-10-block-change-approval-design.md`, `superpowers-plans/2026-04-10-block-change-approval.md` |
| PM My Tasks | `superpowers-specs/2026-04-11-pm-schedule-my-tasks-design.md` |
| Report template designer | `superpowers-plans/2026-04-15-report-template-designer.md` |
| Report generation engine | `superpowers-plans/2026-04-15-report-generation-engine.md` |
| DRY_IN state persistence | `superpowers-plans/2026-04-17-dryin-state-persistence.md` |
| Bloat audit | `bloat.md` |

These were archived (not deleted) because the work is shipped — but the docs remain valuable when revisiting the *why*.

---

## 11. Outstanding work (carried forward from bloat audit)

- **P0.2 — split monster files** (the only bloat-audit item still open). Recommended order from session 04-21:
  1. `apps/web/src/routes/checklist-form/index.tsx` (1561 LOC) — lowest risk, mostly presentational
  2. `apps/api/src/modules/pm-schedules/pm-schedule.service.ts` (1042) — has natural seams
  3. `apps/api/src/modules/filter-operations/filter-operations.service.ts` (1617) — split into `state-machine.ts` + `cycle-workflow.ts`
  4. `apps/web/src/routes/assets/templates.tsx` (1090) + `template-form-editor.tsx` (1070)
  5. `apps/web/src/routes/debug/index.tsx` (1145)
  6. `apps/web/src/routes/filter-management/filter-operations.tsx` (1928) — desktop mirror; must stay behaviorally identical to mobile-operations.tsx
  7. `apps/web/src/routes/filter-management/filter-list.tsx` (2433)
  8. `apps/web/src/routes/rule-chains/editor.tsx` (2140) — most intricate (ReactFlow + 77 node editors)
- **P3.2 — `.playwright-mcp/` accumulation policy** (gitignore + session-end cleanup hook)
- **Decision tape** — design + prototype if pipeline drift recurs (currently mitigated by `stageLookup`)
- **Phase 2/3/4/5 manual test cases** — `tests/manual-test-cases/` only had Phase 1; archived to `old/tests-superseded/`. Need fresh cases for filter operations, RFID, offline replay, reports, block-change approval, PM My Tasks, admin requests.
- **Multi-filter batch checklist dialog** — currently opens for first item only (session 04-20 known follow-up)
- **Cleaning-profile version pinning in offline cache** — stale graph risk if admin edits mid-shift; currently surfaces as sync error rather than pre-validated (mitigation: stale-profile yellow banner)
- **Root working-tree noise** — test PNGs, `.playwright-mcp/`, `backups/` not gitignored (session 04-20 follow-up)

### N/A (no longer apply)
- **P2.1 — in-memory state migration to Redis** — closed N/A: app is local-Windows-only single-instance after EC2 removal (commit `251be95`); no horizontal-scaling concern.
- **P2.2 — BullMQ queue/worker connection factories** — done in session 04-21 (`getWorkerConnection()` per-call, `getQueueConnection()` singleton).
