# 05a — Frontend static audit (apps/web)

Date: 2026-10-17. Branch `RFID` (HEAD `755f0ae`). Method: read-only static reading of `apps/web/src`, `index.html`, `public/`, `vite.config.ts`. A few backend route and service files were read to confirm how the server treats the limits the client sends. No source file was modified. No build was run: `apps/web/dist/index.html` (2026-10-17 12:17) is newer than every file under `src/`, so the sizes below come from the existing `dist/assets`.

Conventions:
- `file:line` paths are relative to `apps/web/src/` unless they start with `apps/api/`.
- "req/min" means API requests per minute from one user on one visible tab, in steady state, with every permission that unlocks the call.
- **[uncertain]** marks anything inferred and not verified at runtime.
- Payload sizes were **not measured**. Where this document says a payload "grows with history", that describes its shape, not a measured byte count.

---

## Top findings (ranked by expected impact at ~100–300 concurrent users)

1. **The tablet polls unbounded whole-table lists, and the server returns everything asked for.**
   - `/m` cycles view: `GET /api/filters/cycles?page=1&limit=1000000&includeEvents=true` every 30 s (`routes/mobile/mobile-wrapper.tsx:351-352`, `routes/mobile/mobile-operations.tsx:569`).
   - Every `/m` view: `GET /api/notifications?limit=1000000` every 60 s, or every 15 s on the notifications view (`mobile-wrapper.tsx:335`). The bell badge only needs `unreadCount`.
   - Every `/m` view: `GET /api/assets/instances` with no limit every 30 s (`mobile-wrapper.tsx:306`, `mobile-operations.tsx:498`).
   - `getCycles` has no cap: `apps/api/src/modules/filter-operations/filter-operations.service.ts:462`, "no page-size cap ... callers get the size they ask for". The route comments in `apps/api/src/modules/filter-operations/events-routes.ts:30-34` say "the service clamps limit to 100 itself". **That comment is stale.**
   - Notifications return all rows when `limit` is large (`apps/api/src/modules/notifications/notification.service.ts:170-181`). Instances return all rows when `limit` is omitted (`apps/api/src/modules/assets/repositories/instance.repository.ts:32`).
   - The cycles and notifications payloads grow with history: every cycle ever, with its events, and every notification the user has.
2. **`syncAllDataForOffline` makes a burst of 14 + P requests, where P is the number of active cleaning profiles.** It is `lib/offline-sync-service.ts:104-283`, and it fires:
   - on tablet mount and on every online flip (`mobile-wrapper.tsx:242-256`);
   - on **every** return to the foreground (`mobile-wrapper.tsx:259-272`);
   - after **every** successful offline drain (`mobile-wrapper.tsx:286-299`).

   It loads whole lists: instances, the 4 hierarchy lists, batch-states, identifiers, and checklists and profiles with `limit=1000000`. It then does one `GET /api/filter-cleaning-profiles/:id` per active profile. If `batch-states` fails, it falls back to one `GET /api/filters/:id/current-state` **per filter** (`offline-sync-service.ts:182-189`), an N+1. At shift start, or when a Wi-Fi blip brings many tablets back at once, every tablet fires this burst together.
3. **The Dry In panel polls `current-state` every 15 s for each drying filter.** `routes/filter-management/components/drying-filters-panel.tsx:314` is inside `DryingRow`, and one row is mounted per filter in `DRY_IN` in the selected block (`mobile-operations.tsx:4215-4226`; desktop `filter-operations.tsx:1956`). That is **4 × N req/min per viewer**: 50 drying filters means 200 req/min from one tablet. Rows whose readings are already submitted "hide themselves" but stay mounted, so they keep polling [uncertain whether the hidden row unmounts; read as: still polling].
4. **The PM Schedules page re-fetches every selected year's full entry list every 15 s.** `routes/pm-schedules/index.tsx:212-225` makes one `?year=Y&limit=1000000` request per year in the range (up to 11 years, capped at `:207`), all inside one SWR key with `refreshInterval: 15000`. That is 4 req/min per selected year, up to 44 req/min, each request carrying a whole year of entries.
5. **Several pollers are plain timers that keep running when the tab is hidden, and some are never stopped.**
   - `/api/health` every 15 s (`lib/connectivity.ts:147`). It starts the first time any page mounts `useOffline` (Filter Operations, `/m`, `/m` operations) and **is never cleared**: there is no stop function, and the `setInterval` lives at module scope. A desktop user who opened Filter Operations once keeps probing at 4 req/min for the rest of the tab's life, including on other pages, while hidden, and after logout.
   - `/api/sync/since` every 60 s (`lib/sync-since.ts:249`). It checks only `isOnline()`, which starts at `navigator.onLine` (`lib/connectivity.ts:24`), so it runs on every AppLayout page for roles with `ASSET_VIEW` or `FILTER_OPERATE` (`components/layout/app-layout.tsx:59-65`), visible or hidden.
   - Browser timer throttling in hidden tabs, and Capacitor WebView suspension, may reduce these in practice **[uncertain]**.
6. **Focus and resume bursts.** The global `revalidateOnFocus: true` (`lib/swr-config.ts:14`) refetches every mounted SWR key that does not opt out, each time the window regains focus (SWR's default 5 s focus throttle). That is 4–11 requests per alt-tab on the main pages; see §1.4. On the tablet, a resume also triggers the item 2 burst, `syncSince`, `/api/health`, and a queue drain at 1 s.
7. **Bundle and deploy cost.**
   - Initial JS is the entry chunk (929 KB raw / 227 KB gzip) plus vendor (48.5 KB / 17.2 KB) plus swr.
   - The entry is large because about 30 admin and config routes are imported eagerly in `main.tsx:12-43`: users, roles, password policy, backup, action re-auth, notifications and others. So are `zod`, `react-hook-form` and the shared permission catalog.
   - Total JS is 4.19 MB raw / 1.14 MB gzip in 86 files.
   - The Workbox precache lists **124 files totalling 5.52 MB**. `globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']` is at `vite.config.ts:49`, and `skipWaiting` + `clientsClaim` are set. Every browser client therefore downloads every lazy chunk, including exceljs (915 KB) and jspdf (413 KB), on first visit and **again after every deploy**: 300 clients × 5.5 MB ≈ 1.6 GB from the server per release (gzip transfer will be lower).
8. **The Audit Trail export downloads up to ~100k rows before it checks the export limit.**
   - `routes/audit/index.tsx:317-334` pages 200 rows at a time for up to 501 pages, then compares against `maxRecords` (default 10,000, `packages/shared/src/schemas/config.ts:150`) at `:356` and `:400`.
   - The Cleaning Record export aborts early instead (`routes/cleaning-cycles/history.tsx:170-191`).
   - `components/SendForReviewButton.tsx` and `routes/cleaning-cycles/timeline.tsx` import `pdf-report` but do not use `useExportLimit` at all.
9. **IndexedDB eviction normally never runs on an always-online tablet.**
   - `evictLruCache` and `compactSyncedOperations` run only at the end of a queue drain (`lib/sync-engine.ts:768-785`), and the drain returns early when nothing is pending (`sync-engine.ts:454`).
   - Expired `cache` rows are ignored on read but **not deleted** (`lib/offline-store.ts:390`).
   - `filter-state-*` rows are exempt from the LRU cap of 1000 (`offline-store.ts:414`).
   - The v5 sync stores (`syncFilters` etc.) are upserted and never pruned. No delete path was found in `lib/sync-since.ts`.
   - Growth is bounded by plant size, not by time, so this is low severity.

---

## 1. Timer-driven requests

### 1.1 Global SWR defaults

`lib/swr-config.ts:12-18`, applied in `main.tsx:163`:

| Option | Value |
|---|---|
| `revalidateOnFocus` | `true` |
| `dedupingInterval` | 5000 |
| `errorRetryCount` | 2 |
| `errorRetryInterval` | 5000 |
| `shouldRetryOnError` | `true` |

Nothing is set for `refreshWhenHidden`, `refreshWhenOffline`, `focusThrottleInterval` or `revalidateOnReconnect`, so the SWR 2 library defaults apply:

| Option | Library default |
|---|---|
| `refreshWhenHidden` | `false` |
| `refreshWhenOffline` | `false` |
| `focusThrottleInterval` | 5000 |
| `revalidateOnReconnect` | `true` |

A grep for `refreshWhenHidden` across `src/` finds **no overrides**. So every SWR `refreshInterval` below pauses while the document is hidden and while `navigator.onLine` is false.

How `refreshInterval` behaves:
- It is a per-hook `setTimeout`, re-armed after each response, so the real period is the interval plus latency.
- Two hooks with the same key each keep their own timer. Their requests merge only when they fall within `dedupingInterval`, so a duplicated key costs between the larger single rate and the sum of both.

### 1.2 App-wide pollers on every AppLayout page (desktop / browser)

| Request | Source | Interval | Pauses when hidden? | On tablet `/m`? |
|---|---|---|---|---|
| `GET /api/notifications/unread-count` | `components/layout/header.tsx:36-39` | 30 s | yes (SWR) | no (`/m` is outside AppLayout, `main.tsx:174`) |
| `GET /api/config/offline-cache/current` | `hooks/use-offline-config.ts:33-44` | 5 min (+ on focus, 60 s dedupe) | yes | yes (`mobile-wrapper.tsx:132`) |
| `GET /api/sync/since?...` | `lib/sync-since.ts:249-251`, started at `components/layout/app-layout.tsx:61-65` | 60 s, plus 1 s-debounced triggers on visible/online | **no** (plain `setInterval`; gated on `isOnline()` only) | yes (`mobile-wrapper.tsx:280-285`) |
| `POST /api/auth/refresh` | `hooks/use-auth.ts:226-229` | 30 min, plus once 5 s after mount | no | yes |
| `GET /sw.js` (static, not API) | `components/pwa-reload-prompt.tsx:44-63` | 60 s, only while visible | yes (custom visibility pause) | hits the WebView-local origin, not the server **[uncertain]** |
| `GET /api/health` | `lib/connectivity.ts:147` | 15 s | **no**, and **never stopped** once started | yes |

`/api/health` runs only after `useOffline()` has mounted (`hooks/use-offline.ts:40-44`): Filter Operations, `/m`, or `/m` operations.

The following are local-only timers and make no network request:
- `hooks/use-session.ts:106`: idle check, 1 s.
- `hooks/use-single-tab.ts:147`: localStorage heartbeat, 1 s.
- `components/hard-cutoff-blocker.tsx:38`: 30 s.
- `components/failed-ops-panel.tsx:56`: IndexedDB `getAll()` of the whole operations store every 8 s. It is mounted in AppLayout `:205` and in `/m` at `mobile-wrapper.tsx:1090`.
- `lib/sync-engine.ts:815`: IndexedDB check every 30 s. It drains, and makes network calls, only when ops are pending.
- `lib/filter-ops/use-dryer-countdown.ts:34`: 1 s tick.

Fetched once and refetched on focus, with no interval:
- `/api/auth/me` (`hooks/use-auth.ts:58`)
- `/api/config/password-policy/current` (`app-layout.tsx:35`)
- `/api/config/my-config` and `/api/pm-schedules/qnn/visible` (`components/layout/sidebar.tsx:259-260`)
- `/api/super-admin/api-lock` (SUPER_ADMIN only, `hooks/use-super-admin-lock.ts:20-23`)

`/api/config/branding` (`hooks/use-branding.ts:61-66`) is fetched once with `revalidateOnFocus: false`.

### 1.3 Page-level pollers

The six pages in scope:

| Page / route | Request | Source | Interval | Tablet? |
|---|---|---|---|---|
| Dashboard `/` | `GET /api/users/stats` (USER_READ) | `routes/dashboard.tsx:84` | 30 s | no |
| Dashboard `/` | `GET /api/audit?limit=1` (AUDIT_READ) | `dashboard.tsx:85` | 30 s | no |
| Dashboard `/` | `GET /api/notifications?limit=1` | `dashboard.tsx:86` | 30 s | no |
| Dashboard `/` | `GET /api/filters/dashboard-stats` (CYCLE_READ) | `dashboard.tsx:87` | 20 s | no |
| Filter list `/filter-list` | `GET /api/hierarchy/tree` (whole tree) | `routes/filter-management/filter-list.tsx:251` | 30 s | no |
| Stage approvals `/stage-approvals`, also `/m` view | `GET /api/stage-approvals/queue` | `routes/stage-approvals/index.tsx:127` | 30 s | yes (`mobile-wrapper.tsx:1987`) |
| My tasks `/my-tasks` | `GET /api/pm-schedules/due[?from&to]` | `routes/my-tasks/index.tsx:94` | 30 s | no (tablet has its own, below) |
| Cleaning record `/cleaning-cycles` | — | `routes/cleaning-cycles/history.tsx` | **no polling** | no |

Tablet `/m` (`MobileWrapperPage`). These hooks are mounted in the wrapper, so they run on every `/m` view:

| Request | Source | Interval |
|---|---|---|
| `GET /api/assets/instances` (no limit, so all rows) | `mobile-wrapper.tsx:306` | 30 s |
| `GET /api/assets/identifiers` (all) | `mobile-wrapper.tsx:308` | 60 s |
| `GET /api/pm-schedules/due` | `mobile-wrapper.tsx:331` | 30 s on the my-tasks view, otherwise 120 s |
| `GET /api/notifications?limit=1000000` | `mobile-wrapper.tsx:335` | 15 s on the notifications view, otherwise 60 s |
| `GET /api/filters/cycles?limit=1000000&includeEvents=true` | `mobile-wrapper.tsx:351-352` | 30 s on the cycles view. Fetched once, with no interval, on the status / rfid-assign / replace views |
| `GET /api/replacement-schedules/tasks` | `mobile-wrapper.tsx:482` | 30 s |

These are added when `/m` shows the operations view (`MobileOperationsPage`, mounted at `mobile-wrapper.tsx:1992-1994`):

| Request | Source | Interval |
|---|---|---|
| `GET /api/assets/instances` (same key as the wrapper's, own timer) | `mobile-operations.tsx:498` | 30 s |
| `GET /api/assets/identifiers` (same key as the wrapper's 60 s hook, own timer) | `mobile-operations.tsx:518` | 30 s |
| `GET /api/replacement-schedules/blocked-filters` | `mobile-operations.tsx:531` | 30 s |
| `GET /api/filters/batch-states` | `mobile-operations.tsx:672`, effect at `:690-694` | 2 s after each change of `instancesData` |
| `GET /api/filters/:id/current-state` × N drying filters | `drying-filters-panel.tsx:314` | 15 s each |

`batch-states` refetches only when the instances content changes. SWR's deep compare keeps the same object reference for unchanged data **[uncertain]**, so this is at most about 2/min.

Other pages outside the six, for completeness:

| Page | Request | Source | Interval |
|---|---|---|---|
| Filter Operations (desktop) | `/api/assets/instances` | `routes/filter-management/filter-operations.tsx:77` | 30 s |
| Filter Operations (desktop) | `/api/hierarchy/filters` | `filter-operations.tsx:90-91` | 30 s |
| Filter Operations (desktop) | — | — | also starts `/api/health` at 15 s |
| PM Schedules | entries, years × `limit=1000000` | `routes/pm-schedules/index.tsx:224` | 15 s |
| Admin requests | `/api/admin-requests` | `routes/admin-requests/index.tsx:115` | 15 s |
| Deviations | `/api/pm-schedules/deviations?...` | `routes/deviations/index.tsx:109` | 30 s |
| Report reviews | `/api/report-reviews/queue` | `routes/report-reviews/index.tsx:32` | 30 s |
| AHU dashboard | `/api/hierarchy/filters?ahuId=` | `routes/filter-management/ahu-dashboard.tsx:53` | 30 s |
| Replacement list | `/api/filters/replacements` | `routes/filter-management/replacement-list.tsx:42` | 30 s |
| Replacement schedule | `/api/replacement-schedules` | `routes/filter-management/replacement-schedule.tsx:127` | 30 s |
| Retirement list | `/api/filters/retirements` | `routes/filter-management/retirement-list.tsx:29` | 30 s |
| Home `/home` | `/api/roles/access-matrix` | `routes/home/index.tsx:31-34` | 30 s |
| System health | — | `routes/system-health/index.tsx:127` | 10 s (toggle) |
| Debug traces | — | `routes/debug/index.tsx:96,100` | 10 s and 30 s |

### 1.4 Requests per minute: one user, one visible tab, steady state

App-wide baseline on every AppLayout page:

| Call | req/min |
|---|---|
| unread-count | 2 |
| sync/since (ASSET_VIEW / FILTER_OPERATE roles) | 1 |
| offline-config | 0.2 |
| JWT refresh | 0.03 |
| **Total** | **≈ 3.2 API req/min** |

Conditional additions: **+4** for `/api/health` once `useOffline` has started in that tab, and +1 for the static `/sw.js` when the SPA is served by the same origin.

| Page | Page-specific timers | Per-user total (API) |
|---|---|---|
| Dashboard | users/stats 2 + audit?limit=1 2 + notifications?limit=1 2 + dashboard-stats 3 = 9 | **≈ 12.2** (fewer for roles lacking USER_READ / AUDIT_READ / CYCLE_READ) |
| Filter list | hierarchy/tree 2 | **≈ 5.2** |
| Stage approvals | queue 2 | **≈ 5.2** |
| My tasks | pm-schedules/due 2 | **≈ 5.2** |
| Cleaning record | 0 | **≈ 3.2** |
| `/m` home view | instances 2 + identifiers 1 + due 0.5 + notifications(all) 1 + replacement tasks 2 + sync/since 1 + health 4 + offline-config 0.2 | **≈ 11.7** |
| `/m` operations view | home-view set + blocked-filters 2 + duplicate-key overlap 0–3 (instances 0–2, identifiers 0–1) + batch-states 0–2 + **4 × N drying filters** | **≈ 13.7–18.7 + 4N** |
| `/m` cycles view | home-view set + cycles(all, with events) 2 | **≈ 13.7** |
| `/m` notifications view | notifications(all) at 4 instead of 1 | **≈ 14.7** |
| `/m` my-tasks view | due at 2 instead of 0.5 | **≈ 13.2** |

Aggregates. These assume everyone sits on the same page; they are not a load profile.

| Users | Mostly desktop at ~5 req/min | Dashboard at ~12 | Tablets on ops view, no Dry In |
|---|---|---|---|
| 100 | ≈ 500 req/min (~8/s) | ≈ 1,220 req/min (~20/s) | ≈ 1,400–1,900 req/min (~23–31/s) |
| 300 | ≈ 1,500 req/min (~25/s) | ≈ 3,660 req/min (~61/s) | ≈ 4,100–5,600 req/min (~68–94/s) |

Each drying filter visible on a tablet adds 4 req/min.

Bursts on top of the steady-state numbers. These are event-driven, not per-minute.
- **Window focus.** Every mounted key that does not opt out revalidates; repeat focuses within 5 s are throttled. Approximate count per focus:

  | Page | Requests per focus |
  |---|---|
  | Dashboard | about 10 (me, password-policy, offline-config, unread-count, my-config, qnn/visible, users/stats, audit, notifications, dashboard-stats) |
  | Filter list | about 10 (layout set + field-options, templates, tree, identifiers, reasons) |
  | Stage approvals | about 8 |
  | My tasks | about 9 |
  | Cleaning record | about 10 |

  These counts are estimates from the hook lists in §3 **[uncertain ±2]**.
- **Tablet resume** (visibilitychange → visible):
  - the full `syncAllDataForOffline`, 14 + P requests;
  - `syncSince`, 1;
  - `/api/health`, 1;
  - a queue drain at 1 s;
  - SWR focus revalidation of every mounted wrapper and operations key: about 6 on home, about 20 on operations.

---

## 2. Whole-list loads (no pagination, huge limit, or client-side filtering)

`lib/page-size.ts:10` defines `ALL_ROWS = 1_000_000` ("no record caps anywhere", operator decision 2026-09-04). The backend honours it.

| Endpoint | Where | Polled? | Payload growth |
|---|---|---|---|
| `/api/filters/cycles?limit=1000000&includeEvents=true` | `mobile-wrapper.tsx:351`, `mobile-operations.tsx:569` | 30 s (cycles view) | **history**: every cycle plus its events |
| `/api/notifications?limit=1000000` | `mobile-wrapper.tsx:335` | 15 s / 60 s | **history**: the user's notifications |
| `/api/pm-schedules/entries?year=Y&limit=1000000` × years | `routes/pm-schedules/index.tsx:214`; export loop `:276` | 15 s | per-year volume |
| `/api/stage-approvals` (no limit sent; no `limit` in the route schema found by grep) | `routes/stage-approvals/index.tsx:128` | on mount / focus | **history** [uncertain whether the server paginates] |
| `/api/assets/instances` (no limit, so all rows; `instance.repository.ts:32`) | `mobile-wrapper.tsx:306`, `mobile-operations.tsx:498`, `filter-operations.tsx:77`, dashboard drill-down `dashboard.tsx:343` (on click), `offline-sync-service.ts:121` | 30 s on tablet / ops | plant size |
| `/api/assets/identifiers` (no pagination in the schema) | `filter-list.tsx:254`, `mobile-wrapper.tsx:308`, `mobile-operations.tsx:518`, `offline-sync-service.ts:232` | 30–60 s on tablet | plant size |
| `/api/hierarchy/tree` (whole nested tree; the route description says "bounded by data shape", `apps/api/src/modules/hierarchy/routes.ts:416-432`) | `filter-list.tsx:251`. The Filter list paginates and filters the tree **client-side** (`filter-list.tsx:258-296`) | 30 s | plant size |
| `/api/hierarchy/filters` (omitted limit returns all, `hierarchy/routes.ts:14-15,120`) | `cleaning-cycles/history.tsx:112`, `filter-operations.tsx:90` (30 s), `offline-sync-service.ts:136`, `replacement-list.tsx:59` (`limit=ALL_ROWS`, SA) | 30 s on ops | plant size |
| `/api/hierarchy/{blocks,areas,ahus}` | `my-tasks/index.tsx:98-99`, `history.tsx:120`, `mobile-operations.tsx:503-504`, `offline-sync-service.ts:133-135` | no | plant size |
| `/api/users?limit=1000000` | SA user pickers. `components/super-admin-cycle-edit.tsx:59` is **unconditional**, not only when the dialog opens; also `audit/index.tsx:63`, `stage-approvals/index.tsx:73`, `deviations/index.tsx:115`, `notifications/index.tsx:152`, `admin-requests/index.tsx:68`, `retirement-list.tsx:44`, `replacement-list.tsx:58`, `rfid-track-record.tsx:90`, `quality-notifications.tsx:78`, `config/notification-rules/index.tsx:209,541`, `config/filter-data-management.tsx:574`, `SendForReviewButton.tsx:38` | no | user count |
| `/api/checklist-profiles?limit=1000000[&expand=questions]` | `checklist-admin/list.tsx:40`, `cleaning-profile-editor.tsx:51`, `version-history/index.tsx:43`, `lib/filter-ops/resolve-pending-checklist.ts:102`, `offline-sync-service.ts:266` | no | config size |
| `/api/filter-cleaning-profiles?limit=1000000` | `home/index.tsx:43`, `config/cleaning-profile-assignment.tsx:46`, `version-history/index.tsx:37`, `filter-data-management.tsx:760`, `offline-sync-service.ts:276`, then **1 GET per profile** (`:283`) | no | config size |
| `/api/block-change-requests?status=APPROVED&limit=1000000` | `mobile-operations.tsx:546` | no | history |
| `/api/filters/cycles?status=IN_PROGRESS&limit=1000000` | `config/equipment-groups.tsx:168` | no | active cycles |
| `${endpoint}?limit=1000000` (generic FDM tabs) | `config/filter-data-management.tsx:662` | no | history |
| `/api/filters/retirements`, `/api/filters/replacements`, admin-requests | Return whole arrays and are paged client-side (documented in CLAUDE.md) | 30 s / 15 s | history |

Server-side observation, for the backend audit. `getCleaningRecord` (`apps/api/src/modules/filter-operations/filter-operations.service.ts:277-330`) loads **every** matching cycle id and every manual-event id (`findMany` with no `take`) on every page request, merges them in memory, then slices one page. The client constant `SERVER_CYCLE_CAP = 5000` (`cleaning-cycles/history.tsx:37-40`), "server takes at most this many cycles", has **no matching cap** in the current service, so it is stale. The client's "server caps `limit` at 100" comment (`history.tsx:173`) is also stale.

---

## 3. First-load request waterfalls

Stage 0 is common to every AppLayout page. These fire during AppLayout render, before the `isLoading` gate:
- `GET /api/auth/me` (`use-auth.ts:58`; `fallbackData` = cached user)
- `GET /api/config/offline-cache/current`
- `GET /api/config/branding`
- `GET /api/config/password-policy/current`
- `GET /api/super-admin/api-lock` (SA only)

The page, Header and Sidebar render after `/api/auth/me` resolves (`app-layout.tsx:70`) **[uncertain whether `fallbackData` makes SWR's `isLoading` false immediately; if it does, stages 0 and 1 run in parallel]**.

Stage 1, layout chrome:
- `GET /api/notifications/unread-count`
- `GET /api/config/my-config`
- `GET /api/pm-schedules/qnn/visible`

Deferred:
- `GET /api/sync/since` at +1 s (debounced `triggerSync('app-start')`)
- `POST /api/auth/refresh` at +5 s

Lazy JS chunks are fetched in parallel with stage 1, for every page except the eagerly loaded Dashboard and Home.

Stage 2, page hooks. All fire in parallel on mount; none depends on another's result unless noted.

| Page | Calls on mount (after stages 0–1) | Count |
|---|---|---|
| **Dashboard** | `/api/users/stats`*, `/api/audit?limit=1`*, `/api/notifications?limit=1`, `/api/filters/dashboard-stats`*, `/api/config/dashboard-cards/current`, `/api/config/datetime/current` (* = permission-gated) | 6 |
| **Filter list** | `/api/filters/field-options`, `/api/filters/reasons` (SA), `/api/assets/templates`, `/api/hierarchy/tree`, `/api/assets/identifiers`, `/api/config/export-limit/current`, `/api/config/pagination/current`, `/api/config/action-reauth/my-actions`, `/api/config/datetime/current` + JS chunks `filter-list` (155 KB) and **`pdf-report` (413 KB)**, which is statically imported | ~9 |
| **Stage approvals** | `/api/stage-approvals/queue`, `/api/stage-approvals` (all), `/api/users?limit=1000000` (SA), `/api/roles` (SA), `/api/config/action-reauth/my-actions`, `/api/config/datetime/current`. Then on demand: one `/api/filters/cycles/:id` per opened row (`:90`) | 4–6 |
| **My tasks** | `/api/pm-schedules/due`, `/api/hierarchy/blocks`, `/api/hierarchy/areas`, `/api/config/datetime/current` | 4 |
| **Cleaning record** | `/api/hierarchy/filters` (all), `/api/hierarchy/blocks`, `/api/filters/cleaning-record?page&limit`, `/api/config/export-limit/current`, `/api/config/report-labels/current`, `/api/config/pagination/current`, `/api/config/action-reauth/my-actions`, `/api/config/datetime/current`. Then dependent: `/api/hierarchy/areas?blockId=` after a block is chosen, and `/api/hierarchy/ahus?areaId=` after an area is chosen + JS chunk `pdf-report` | ~8 |
| **`/m` tablet** (operations view) | See below | ~44 + P + 4N |

`/m` tablet waterfall, operations view. `/m` is outside AppLayout:
1. Wrapper (11 requests): me, branding, datetime, offline-config, `tablet-access/my-features`, `action-reauth/my-actions`, instances, templates, identifiers, pm due, notifications(all), replacement tasks.
2. In parallel, `syncAllDataForOffline` (14 + P requests): templates, then instances, then 4 hierarchy lists in parallel, then batch-states, then reasons, then equipment-groups, then identifiers, then pm due, then checklists(all), then profiles(all), then P × profile detail. These run mostly **sequentially** (`offline-sync-service.ts:104-283`). Many duplicate the SWR calls above: the same URLs, but `apiClient.get` bypasses SWR dedupe.
3. In parallel, `syncSince` at +1 s, `/api/health` immediately and then every 15 s, and the `requeueStuckSyncing` drain at +3 s.
4. Operations view (19 requests): `tablet-access/my-features`, instances, templates, `hierarchy/ahus`, `hierarchy/areas`, `filters/reasons`, identifiers, `equipment-groups`, `cleaning-profile-assignment/current`, `filter-cleaning-profiles?status=ACTIVE&expand=stages,connections`, `checklist-profiles?expand=questions`, `blocked-filters`, branding, `field-ids/current`, datetime, `block-change-requests?...limit=1000000`, `action-reauth/my-actions`, `block-change-approval/current`, AHU completion mode. Then `batch-states` 2 s after instances arrive, and N × `current-state` once a block with drying filters is selected.

So a cold `/m` open costs roughly **40–45 + P requests**, about a third of them duplicates. At a 100-tablet shift start that is ~4,500 requests within a few seconds.

---

## 4. Client-side PDF / Excel generation

- Libraries:
  - `exceljs` is loaded with `await import('exceljs')` (`lib/excel-export.ts:45`, chunk 915 KB raw / 263 KB gzip).
  - `jspdf` + `jspdf-autotable` are **statically** imported by `lib/pdf-report.ts:1-2` (chunk 413 KB / 135 KB gzip). That module is statically imported by 13 route files (audit, history, timeline, filter-lifecycle, deviations, filter-list, quality-notifications, replacement-list, replacement-schedule, retirement-list, rfid-track-record, pm-schedules, SendForReviewButton), so the chunk downloads when those pages open, not on the export click.
  - `html2canvas` (196 KB), `purify` and `index.es` (canvg) are jspdf's own lazy chunks.
- Everything is built **fully in memory**:
  - Excel: rows go in with `ws.addRow` (`excel-export.ts:61-63`), then the whole file is materialised with `wb.xlsx.writeBuffer()` (`:66`).
  - PDF: built with `autoTable` (`pdf-report.ts:358`), then `doc.save` (`:418,451`).
  - Before any of that, every source row is held as a JS array.
- Limit: `useExportLimit()` (`hooks/use-export-limit.ts:20-33`) reads `GET /api/config/export-limit/current`. The default `maxRecords` is **10,000** (`packages/shared/src/schemas/config.ts:150`), with "no ceiling since 2026-09-04". It is used in 11 files. Two exporters do not use it: `components/SendForReviewButton.tsx` and `routes/cleaning-cycles/timeline.tsx`.

How the export paths fetch their rows:

| Export | Fetch strategy | Limit check |
|---|---|---|
| Cleaning record (`history.tsx:170-199`) | 100 rows per page, up to 100 pages (10,000 rows hard stop from the loop bound) | **incremental**: aborts as soon as the count passes `maxRecords` |
| Audit trail (`audit/index.tsx:317-334`) | 200 per page, up to 501 pages (~100,200 rows) | **after** fetching everything (`:356`, `:400`) |
| Filter list (`filter-list.tsx:1551,1559`) | rows already in memory from `/api/hierarchy/tree` | after building the body |
| PM schedules (`pm-schedules/index.tsx:276-280`) | `limit=ALL_ROWS` per year | — |

The cleaning-record loop bound (`p <= 100` × 100 rows) silently caps at 10,000 rows if `maxRecords` is raised above 10,000 [inference from the code].

At 10k rows with the cycle events attached, expect tens of MB of JS heap on a tablet; this is **not measured**.

---

## 5. Bundle

Source: existing `apps/web/dist/assets`, built 2026-10-17 12:17, newer than all `src/` files, so **no rebuild was run**. Gzip sizes were computed with node `zlib.gzipSync(level 9)`.

| Chunk | Raw | Gzip |
|---|---|---|
| `index-DSTwt5Sw.js` (entry) | 929.2 KB | 227.2 KB |
| `exceljs.min` | 915.0 KB | 263.0 KB |
| `pdf-report` (jspdf + autotable) | 413.5 KB | 134.9 KB |
| `mobile-wrapper` | 211.8 KB | 51.6 KB |
| `html2canvas.esm` | 196.3 KB | 46.1 KB |
| `index.css` | 173.1 KB | 21.8 KB |
| `filter-list` | 155.2 KB | 32.4 KB |
| `index.es` (canvg) | 155.2 KB | 51.7 KB |
| `filter-data-management` | 102.9 KB | 20.6 KB |
| `filter-operations` | 74.7 KB | 19.6 KB |
| `pm-pending-tasks-dialog` | 54.5 KB | 16.6 KB |
| `vendor` (react-router etc.) | 48.5 KB | 17.2 KB |

Totals:
- **JS:** 86 files, **4,190.6 KB raw / 1,139.6 KB gzip**.
- **CSS:** 173.1 KB / 21.8 KB.
- **Initial load JS:** entry + vendor + swr ≈ 1.0 MB raw / ~250 KB gzip.
- **Precache:** `dist/sw.js` lists 124 URLs totalling **5,524,005 bytes**.
- **Fonts:** `dist/fonts` is 600 KB.

Code splitting:
- `main.tsx` uses `React.lazy` for about 55 routes (`main.tsx:31-107`), including every filter-management, report, PM, mobile and most config page.
- **Imported eagerly** (`main.tsx:12-43`): Dashboard, Home, login/forgot/change-password/contact-admin/guest-request, users list/create/edit/reset-requests, config index, password-policy, datetime, role-access, user-id, access-matrix, replacement-schedule-filters, offline-cache, backup, dynamic-config, action-reauth, notifications, profile.

Entry chunk composition, from its hidden sourcemap. These are **source characters, not output bytes**, so they show proportion only:

| Source | Source chars |
|---|---|
| react-dom | ~525 K |
| zod | ~146 K |
| config/roles-components | ~111 K |
| shared types | ~109 K |
| react-hook-form | ~109 K |
| tailwind-merge | ~73 K |
| offline-store + sync-engine | ~84 K |
| notifications page | ~40 K |
| backup page | ~38 K |
| action-reauth page | ~35 K |

react-dom appears in the entry even though `manualChunks.vendor` includes it (`vite.config.ts:98-101`), probably because `react-dom/client` does not match the rule **[unverified]**.

`vite.config.ts` sets `chunkSizeWarningLimit: 800`; both the entry and exceljs exceed it.

Minor: `public/fonts/fonts.css` (Bricolage Grotesque) and its woff2 files are copied to `dist/fonts`. No reference to `fonts.css` was found in `src/`, `public/` or `index.html` (`index.html` loads only `/fonts/plex.css`), but the woff2 files match the precache glob, so they are precached anyway [verify before removal].

---

## 6. Potential memory leaks / unbounded growth in long sessions

No React-level leak was found. Every `setInterval` and `addEventListener` in components and hooks has a matching cleanup. The only imbalances found by per-file counting are app-lifetime singletons:

| Site | What stays registered | Effect |
|---|---|---|
| `lib/connectivity.ts:107-155` | 3 listeners plus a 15 s interval; no stop function | Intended as a singleton, but keeps network traffic going after logout (Top finding 5) |
| `components/pwa-reload-prompt.tsx:62` | `visibilitychange` | One per SW registration |
| `main.tsx:152` | `serviceWorker` `message` listener | Once |
| `lib/sync-engine.ts:808-865` (`startAutoSync`) | Timers | Started from `useOffline`; `stopAutoSync` exists (`:867`) but no caller was found |

Growth points:

| Store | Behaviour | Bound |
|---|---|---|
| SWR in-memory cache (default Map provider) | Every distinct key stays for the tab's life. Paged lists (`/api/audit?page=N&...`, cleaning-record with filters/dates) add one entry per page and filter combination, including the 1M-row responses held as JS objects (cycles with events, notifications) | none (SWR has no eviction) |
| IDB `cache` store | LRU cap 1000 (`offline-store.ts:53`), but `filter-state-*`, `identifier-map`, `cleaning-profile-assignment` and `active-profile-*` are exempt (`:414`). `evictLruCache` runs only after a non-empty drain (`sync-engine.ts:454,780`). Expired rows are not deleted on read (`offline-store.ts:390`) | plant size in practice; no time bound |
| IDB `operations` | `failed` ops are kept indefinitely "for operator visibility" (`offline-store.ts:429-447`); synced ops are cleared after a drain | manual clear |
| IDB v5 sync stores (`syncFilters`, `syncFilterCleaningProfiles`, …) | Upsert only (`sync-since.ts:178-185`); no prune or tombstone path found | plant size; retired / deleted entities linger [uncertain] |
| `failed-ops-panel.tsx:44-57` | `getAll()` of the entire operations store every 8 s | CPU / IDB I/O grows with the store size |

---

## 7. External runtime URLs

**None found.**

- `index.html` loads only same-origin `/fonts/plex.css`, `/assets/*` and `/manifest.webmanifest`. Its comment says fonts are self-hosted on purpose for air-gapped plants.
- `public/fonts/plex.css` uses only `url(/fonts/plex/...)`.
- No grep hits in `src`, `public` or `index.html` for: googleapis, gstatic, cdnjs, jsdelivr, unpkg, google-analytics, googletagmanager, sentry.

The only public-host strings are UI placeholders or comments, never fetched:
- `routes/config/notification-settings/email-settings.tsx:482,486,832` (OAuth token URL / scope / SMS gateway example placeholders)
- `lib/excel-export.ts:15` (`http://evil/` in a CSV-injection comment)

Inside the built chunks, the only matches are documentation strings inside libraries (jszip docs link in exceljs, the reactrouter.com error-message link).

Workbox `runtimeCaching: []` (`vite.config.ts:51`), so the service worker makes no runtime cross-origin fetches.
