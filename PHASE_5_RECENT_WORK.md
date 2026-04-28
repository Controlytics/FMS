# Phase 5 — Reports, Offline Hardening, RFID SDK, Filter Data Console (April 15–29, 2026)

This doc captures the architecture and behavior changes that landed **after** the Phase 4 release (`2.3.0`, 2026-04-14). Everything here is live in the working tree on branch `RFID`. CHANGELOG entries `2.4.0` and `2.5.0` summarize the same work in release-note form; this doc focuses on the *why* and the cross-cutting design decisions.

---

## 1. Reports Module (phases A–F complete)

Server-side report generation engine that resolves variable tags, renders HTML with charts, converts to PDF via Puppeteer, and serves downloadable reports.

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
- **Stale-profile guard** — replay refuses to apply ops against a profile version that has changed; surfaces `STALE_PROFILE` error
- **Pre-cache on login** — full master-data hydration as soon as the user is authenticated (not lazy)
- **Server-side `stageLookup`** — resolves stage chains across multiple consecutive CHECKLIST nodes (was: client tried to walk the graph and got it wrong with chained checklists)

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
| Filter | `/filter-list/:id` | template fields, parent hierarchy |
| Cleaning Cycles | `/cleaning-cycles/history` | profile, stage, status, performer |
| Filter Events | `/filter-traceability/:id` | event type, timestamp, performer, payload |
| Alarms | `/alarms` | severity, threshold, value |
| PM Entries | `/pm-schedules/:id` (detail card grid) | scheduled date, tolerance window, status |
| Audit Trail | `/audit` | actor, action, before/after diff |
| Notifications | `/notifications` | channel, status, payload |
| Admin Requests | `/admin-requests` | requester, type, status |
| Block Changes | `/approvals` | from-block, to-block, status |

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

- **Forgot-password flow + show/hide password + lockout-progress UI** on tablet (`a5fc98f`)
- **Admin requests approval execution** — approvals actually create/unlock/reset/modify users; requester Employee ID required; UUIDs hidden in audit
- **Block-change request lifecycle** — cross-block approval popup (desktop + mobile); single-use consumption; remarks mandatory (memory `project_block_change_approval`)
- **PM "My Tasks" v1** — CSV bulk upload, `/api/pm-schedules/due`, expandable AHU cards, filter-set modes (memory `project_pm_my_tasks`)
- **Capacitor online detection** — poll `/api/health` every 15 s + on `visibilitychange` (memory `feedback_capacitor_online_detection`)
- **className codemod merge rule** — when replacing inline-style with className, merge into existing className attribute (memory `feedback_codemod_className_merge`)

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

- **P0.2 — split monster files**:
  - `apps/web/src/routes/filter-management/filter-list.tsx` (2433 LOC)
  - `apps/web/src/routes/rule-chains/editor.tsx` (2140 LOC)
  - `apps/web/src/routes/filter-management/filter-operations.tsx` (1928 LOC)
  - `apps/api/src/modules/filter-operations/filter-operations.service.ts` (1617 LOC)
- **P2.1 — in-memory state migration to Redis** (rate-limit, cooldown, retries) — needed before horizontal scaling
- **P2.2 — BullMQ queue/worker connection factories**
- **P3.2 — `.playwright-mcp/` accumulation policy** (gitignore + Stop hook)
- **Decision tape** — design + prototype if pipeline drift recurs
- **Phase 2/3/4/5 test cases** — `tests/manual-test-cases/` only had Phase 1 cases; archived to `old/tests-superseded/`. Need fresh cases for filter operations, RFID, offline replay, reports, block-change approval.
