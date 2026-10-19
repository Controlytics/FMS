# Frontend feature inventory — DigiLog / FMS web + tablet

Read-only discovery against branch `RFID` (uncommitted working tree), 2026-10-19. No source file was modified, no node process was started. Paths are relative to `apps/web/src/` unless prefixed.

## 1. Scope, method, coverage

**What was read.** `main.tsx` (all 76 `<Route>` elements), every page component under `routes/` (160 non-test `.ts/.tsx` files, 60,092 lines), the shared behaviour components (`components/`, `hooks/`, `lib/` where a page depends on them), and the backend route/def files cited where a frontend gate had to be matched against the server gate. The per-page enumeration was split into seven part files by area; each part states its own coverage line and skipped ranges at the top.

| Part | Area | Routes | File |
|---|---|---|---|
| 01 | Tablet / Capacitor UI (`/m*`) | `/m/login`, `/m/forgot-password`, `/m/server-config`, `/m` (+ its internal views) | [parts/01-mobile.md](parts/01-mobile.md) |
| 02 | Filters page | `/filter-list` (+ 17 dialogs) | [parts/02-filter-list.md](parts/02-filter-list.md) |
| 03 | Filter operations + filter-management pages | `/filters*`, `/ahus/:id`, `/filter-cleaning-profiles*`, `/replacement-schedule`, `/filter-replacements`, `/filter-retirements`, `/rfid-track-record`, `/quality-notifications` | [parts/03-filter-ops.md](parts/03-filter-ops.md) |
| 04 | Heavy config pages | `/config/filter-data-management`, `/config/backup`, `/config/help`, `/config/notification-rules`, `/config/email-settings`, `/config/sms-settings`, `/config/notification-logs`, `/config/action-reauth`, `/config/equipment-groups`, `/config/ldap` | [parts/04-config-heavy.md](parts/04-config-heavy.md) |
| 05 | Remaining config pages | `/config`, `/config/dynamic/:moduleKey`, `/config/roles`, `/config/role-assignments`, `/config/password-policy`, `/config/datetime`, `/config/user-id`, `/config/access-matrix`, `/config/replacement-schedule-filters`, `/config/offline-cache`, `/config/tablet-access`, `/config/appearance`, `/config/display-settings`, `/config/report-config`, `/config/filter-setup`, `/config/ahu-filter-set-config` (+ 12 tab panels with no route of their own) | [parts/05-config-rest.md](parts/05-config-rest.md) |
| 06 | Auth, users, audit, notifications, dashboard, misc admin | `/login`, `/forgot-password`, `/change-password`, `/contact-admin`, `/guest-request`, `/`, `/home`, `/profile`, `/users*`, `/audit`, `/notifications`, `/system-health`, `/debug/traces`, `/version-history`, `/hierarchy-preview`, `/checklists*` | [parts/06-admin.md](parts/06-admin.md) |
| 07 | PM, cycles, approvals / workflow | `/pm-schedules*`, `/my-tasks`, `/deviations`, `/cleaning-cycles*`, `/filter-lifecycle-report`, `/approvals`, `/admin-requests`, `/stage-approvals`, `/report-reviews` | [parts/07-pm-cycles.md](parts/07-pm-cycles.md) |

**Provenance note (2026-10-19, later the same day).** The seven part files were deleted by another agent's cleanup after this merge and were re-created verbatim by their original authors from their own transcripts. Verification after restore: identical byte sizes (68,208 / 58,015 / 89,428 / 105,808 / 78,381 / 81,206 / 86,572) and line counts (296 / 215 / 277 / 372 / 288 / 307 / 265) to the originals, the § 2 count command reproduces every number below unchanged, zero "(not restored)" markers, and the § 3 route-coverage check still finds all 75 paths. Do not delete `parts/` — the merged file links into it and the authors' hand-back reports were never delivered, so the files are the only copy.

**What was skipped (declared by the parts).**
- Part 03: `lib/filter-ops/use-core.ts` internals (reducer/cache logic, lines 240-484, 500-607, 623-711, 749-924) were not read line by line; only its exported surface and the three `executeOrQueue` write sites.
- Part 06: `routes/audit/audit-helpers.ts` read only at 89-110, 200-262, 385-416; `routes/home/module-flows.ts` and `routes/debug/components/*.tsx` only grepped for handlers; `routes/home/types.ts` not read.
- All parts: the shared `components/reauth-dialog.tsx`, `components/super-admin-record-edit.tsx` and `components/super-admin-cycle-edit.tsx` bodies were read by part 04 only; other parts mark their dismiss behaviour "UNVERIFIED (shared)". Part 04's reading (FE-D-409/410) is authoritative.
- Anything marked `UNVERIFIED` in a part is a claim the author could not settle from the code alone (usually a backend response shape). None were guessed.

**ID scheme.** `FE-R-nnn` routes (this file, § 3). Per part: pages `FE-P-x01..`, dialogs `FE-D-x01..`, forms `FE-F-x01..`, actions `FE-A-x001..`, where `x` is the part number, so ids never collide. Tables and suspicious rows are keyed to their page id with a suffix (`FE-P-3xx/Tn`, `FE-P-3xx/Sn`) or numbered per part.

## 2. Counts

Rows carrying an ID in each part (command in § 6, F1):

| Part | Pages | Dialogs | Forms | Actions | Table rows | Suspicious rows |
|---|---|---|---|---|---|---|
| 01-mobile | 18 | 18 | 19 | 102 | 18 | 21 |
| 02-filter-list | 6 | 24 | 14 | 91 | 8 | 17 |
| 03-filter-ops | 12 | 24 | 19 | 106 | 16 | 46 |
| 04-config-heavy | 34 | 35 | 39 | 153 | 24 | 52 |
| 05-config-rest | 32 | 9 | 28 | 99 | 21 | 36 |
| 06-admin | 31 | 23 | 18 | 132 | 11 | 40 |
| 07-pm-cycles | 22 | 24 | 17 | 112 | 11 | 36 |
| **Total** | **155** | **157** | **154** | **795** | **109** | **248** |

Notes on the totals. "Pages" includes tab panels and tablet views that have no route of their own (e.g. the 12 config tab panels in part 05, the 15 tablet views in part 01), so it exceeds the 75 route paths. "Dialogs" includes native `window.confirm/alert/prompt` call sites (22 in `routes/` + `components/`, F7) and shared `ReauthDialog` mounts counted once per page. "Suspicious rows" include a few explicit "checked, clean" rows (e.g. 02/S-16, 04/S51, 06/S-38, 07/#35).

Raw code-level counts (F2-F9):

| Measure | Count |
|---|---|
| `<Route` elements in `main.tsx` (word boundary; `grep -c "<Route"` gives 77 because it also matches `<Routes>`) | 76 |
| of which with a `path=` | 75 (74 pages + `*` catch-all → `/`) |
| of which the pathless `AppLayout` layout route | 1 |
| Routes wrapped in `RequireRole` | 63 |
| Lazy-loaded page chunks | 48 |
| `<button` / `<Button` elements in `routes/` + `components/` | 836 |
| `onClick=` handlers | 908 |
| `<input` / `<Input` / `<select` / `<Select` / `<textarea` / `<SearchableSelect` | 507 |
| `<form` elements (most pages submit from a button `onClick`) | 12 |
| `useSWR(` call sites | 377 |
| `api.`/`apiClient.` get/post/put/patch/delete call sites | 271 |
| Raw `fetch(` in `routes/` (bypassing `api-client`) | 23 |
| Files calling `useReauth()` | 68 |
| `<ReauthDialog>` / `<ReauthPrompt>` mounts | 74 |
| SWR `refreshInterval:` sites / `setInterval(` sites | 35 / 16 |
| Hand-rolled `fixed inset-0` overlays (vs 26 uses of the shared `<Dialog>`) | 74 |
| `console.log/debug/info` in production paths | 0 (`console.warn/error` exist, listed in parts) |
| Files importing `normalizeRfidScan` | 4 (`stage-scan-dialog`, `filter-operations`, `mobile-operations`, `mobile-wrapper`) |

## 3. Route table (FE-R) and coverage check

Every `<Route path=…>` in `main.tsx` was grepped against the seven parts (command F10). **Result: 75 of 75 paths appear in at least one part. None missing.** Guards are quoted from `main.tsx`; `RequireRole` (`components/require-role.tsx:9-61`) lets SUPER_ADMIN through unconditionally, then `roles.includes(user.role)`, then `permissions.some(p ∈ user.permissions)`; `roles={[]}` therefore means SUPER_ADMIN only. Sidebar ids are from `components/layout/sidebar.tsx:23-232`; "(Reports)" = child of the collapsible Reports group (`:238-247`).

| ID | Path | Component (file) | Guard (`main.tsx` line) | Sidebar item | Inventoried in |
|---|---|---|---|---|---|
| FE-R-001 | `/m/login` | `routes/mobile/mobile-login.tsx` (lazy) | public (171) | — | 01 FE-P-101 |
| FE-R-002 | `/m/forgot-password` | `routes/mobile/mobile-forgot-password.tsx` (lazy) | public (172) | — | 01 FE-P-102 |
| FE-R-003 | `/m/server-config` | `routes/mobile/server-config.tsx` (lazy) | public (173); forced on native when no server stored (137) | — | 01 FE-P-103 |
| FE-R-004 | `/m` | `routes/mobile/mobile-wrapper.tsx` (lazy) | in-page redirect to `/m/login` when no token; tablet-access allowlist (174) | — (tablet shell) | 01 FE-P-104..118 |
| FE-R-005 | `/login` | `routes/auth/login.tsx` | public (177) | — | 06 FE-P-601 |
| FE-R-006 | `/forgot-password` | `routes/auth/forgot-password.tsx` | public (178) | — | 06 FE-P-602 |
| FE-R-007 | `/change-password` | `routes/auth/change-password.tsx` | public route; reads `useAuth().user` (179) | — | 06 FE-P-603 |
| FE-R-008 | `/contact-admin` | `routes/auth/contact-admin.tsx` | public (180) | — | 06 FE-P-604 |
| FE-R-009 | `/guest-request` | `routes/auth/guest-request.tsx` | public (181) | — | 06 FE-P-605 |
| FE-R-010 | *(layout, no path)* | `components/layout/app-layout.tsx` in `RouteErrorBoundary` | auth required; force-password-change redirect; single-tab; SA lockdown (184) | — | § 4 below |
| FE-R-011 | `/` | `routes/dashboard.tsx` | auth only (185) | `dashboard` | 06 FE-P-613 |
| FE-R-012 | `/home` | `routes/home/index.tsx` | auth only (186) | `home` | 06 FE-P-614 |
| FE-R-013 | `/profile` | `routes/profile/index.tsx` | auth only (187) | header menu | 06 FE-P-612 |
| FE-R-014 | `/users` | `routes/users/list.tsx` | USER_READ \| USER_CREATE \| USER_UPDATE \| USER_DELETE \| USER_RESET_PASSWORD \| USER_UNLOCK \| USER_ENABLE_DISABLE (190) | `users` | 06 FE-P-606 |
| FE-R-015 | `/users/create` | `routes/users/create.tsx` | USER_CREATE (191) | — | 06 FE-P-607 |
| FE-R-016 | `/users/reset-requests` | `routes/users/reset-requests.tsx` | USER_RESET_PASSWORD (192) | — | 06 FE-P-609 |
| FE-R-017 | `/users/:id` | `routes/users/edit.tsx` | USER_READ (193) | — | 06 FE-P-608 |
| FE-R-018 | `/config` | `routes/config/index.tsx` | CONFIG_READ (196) | `configuration` | 05 FE-P-501 |
| FE-R-019 | `/config/role-assignments` | `routes/config/role-assignments.tsx` (lazy) | `roles={[]}` = SA only (198) | — | 05 FE-P-507 |
| FE-R-020 | `/config/password-policy` | `routes/config/password-policy.tsx` | CONFIG_READ (199) | — | 05 FE-P-508 |
| FE-R-021 | `/config/ldap` | `routes/config/ldap.tsx` (lazy) | CONFIG_READ (200) | — | 04 FE-P-410 |
| FE-R-022 | `/config/datetime` | `routes/config/datetime.tsx` | `roles=['SUPER_ADMIN']` (204) | — | 05 FE-P-509 |
| FE-R-023 | `/config/backup` | `routes/config/backup.tsx` | CONFIG_READ (205) | — | 04 FE-P-402 |
| FE-R-024 | `/config/appearance` | `routes/config/appearance.tsx` (lazy) | SA (208) | — | 05 FE-P-515..517 |
| FE-R-025 | `/config/report-config` | `routes/config/report-config.tsx` (lazy) | SA (209) | — | 05 FE-P-522..526 |
| FE-R-026 | `/config/roles` | `routes/config/role-access.tsx` | ROLE_MANAGE (210) | — | 05 FE-P-503..506 |
| FE-R-027 | `/config/display-settings` | `routes/config/display-settings.tsx` (lazy) | SA (211) | — | 05 FE-P-518..521 |
| FE-R-028 | `/config/user-id` | `routes/config/user-id.tsx` | CONFIG_READ (212) | — | 05 FE-P-510 |
| FE-R-029 | `/config/access-matrix` | `routes/config/access-matrix.tsx` | SA (213) | — | 05 FE-P-511 |
| FE-R-030 | `/config/replacement-schedule-filters` | `routes/config/replacement-schedule-filters.tsx` | SA (214) | — | 05 FE-P-512 |
| FE-R-031 | `/config/offline-cache` | `routes/config/offline-cache.tsx` | SA (215) | — | 05 FE-P-513 |
| FE-R-032 | `/config/action-reauth` | `routes/config/action-reauth.tsx` | SA (216) | — | 04 FE-P-408 |
| FE-R-033 | `/config/email-settings` | `routes/config/notification-settings/email-settings.tsx` (lazy) | SA (217) | — | 04 FE-P-405 |
| FE-R-034 | `/config/sms-settings` | same component, `defaultTab="sms"` (lazy) | SA (218) | — | 04 FE-P-406 |
| FE-R-035 | `/config/notification-rules` | `routes/config/notification-rules/index.tsx` (lazy) | SA (219) | — | 04 FE-P-404 |
| FE-R-036 | `/config/notification-logs` | `routes/config/notification-settings/notification-logs.tsx` (lazy) | SA (220) | — | 04 FE-P-407 |
| FE-R-037 | `/config/dynamic/:moduleKey` | `routes/config/dynamic-config.tsx` | CONFIG_READ (221); every def that renders here is `requiredRole: 'SUPER_ADMIN'` so non-SA gets a 403 panel | — | 05 FE-P-502, FE-P-532 |
| FE-R-038 | `/system-health` | `routes/system-health/index.tsx` (lazy) | `roles=['SUPER_ADMIN','ADMIN']` (224) | `system-health` | 06 FE-P-615 |
| FE-R-039 | `/debug/traces` | `routes/debug/index.tsx` (lazy) | READ_DEBUG_TRACE (227) | `debug-traces` | 06 FE-P-616 |
| FE-R-040 | `/config/help` | `routes/config/help.tsx` (lazy) | SA (231) | — | 04 FE-P-403 |
| FE-R-041 | `/notifications` | `routes/notifications/index.tsx` | NOTIFICATION_VIEW \| NOTIFICATION_MANAGE (237) | `notifications` | 06 FE-P-611 |
| FE-R-042 | `/filter-list` | `routes/filter-management/filter-list.tsx` (lazy) | ASSET_READ \| ASSET_VIEW \| FILTER_HIERARCHY_{CREATE,EDIT,DELETE} \| FILTER_{CREATE,EDIT,DELETE,RETIRE,REPLACE,BULK_UPLOAD,RFID_MANAGE,STATUS_UPDATE} (242) | `filter-list` | 02 FE-P-201..204 |
| FE-R-043 | `/approvals` | `routes/approvals/index.tsx` (lazy) | BLOCK_CHANGE_APPROVE \| BLOCK_CHANGE_REQUEST (243) | `approvals` | 07 FE-P-708 |
| FE-R-044 | `/replacement-schedule` | `routes/filter-management/replacement-schedule.tsx` (lazy) | REPLACEMENT_SCHEDULE_{VIEW,UPLOAD,REVIEW,APPROVE} (244) | — (tab of `/filter-replacements`) | 03 FE-P-308 |
| FE-R-045 | `/filter-retirements` | `routes/filter-management/retirement-list.tsx` (lazy) | RETIREMENT_LIST_VIEW (245) | `filter-retirements` | 03 FE-P-310 |
| FE-R-046 | `/rfid-track-record` | `routes/filter-management/rfid-track-record.tsx` (lazy) | ASSET_VIEW \| ASSET_READ \| FILTER_RFID_MANAGE (246) | `rfid-track-record` (Reports) | 03 FE-P-311 |
| FE-R-047 | `/quality-notifications` | `routes/filter-management/quality-notifications.tsx` (lazy) | **none** — bare `<Suspense>` (247); page self-gates on `GET /api/pm-schedules/qnn/visible` after mount | `quality-notifications` (Reports; hidden until `/qnn/visible`) | 03 FE-P-312 |
| FE-R-048 | `/filter-replacements` | `routes/filter-management/replacement-list.tsx` (lazy) | REPLACEMENT_LIST_VIEW \| REPLACEMENT_SCHEDULE_* (248) | `filter-replacements` | 03 FE-P-309 |
| FE-R-049 | `/config/filter-data-management` | `routes/config/filter-data-management.tsx` (lazy) | `roles={[]}` = SA only (254) | — | 04 FE-P-401 |
| FE-R-050 | `/config/tablet-access` | `routes/config/tablet-access.tsx` (lazy) | CONFIG_UPDATE \| CONFIG_READ (255) | — | 05 FE-P-514 |
| FE-R-051 | `/filters` | `routes/filter-management/filter-operations.tsx` (lazy) | FILTER_OPERATE \| ASSET_READ (256) | `filter-operations` | 03 FE-P-301 |
| FE-R-052 | `/filters/stage/:stageKey` | same component | same (257) | — | 03 FE-P-302 |
| FE-R-053 | `/checklists` | `routes/checklist-admin/list.tsx` (lazy) | FCP_READ \| CHECKLIST_{TOGGLE,CREATE,EDIT,DELETE} \| VERSION_HISTORY_VIEW (258) | `checklists` | 06 FE-P-619 |
| FE-R-054 | `/checklists/:id` | `routes/checklist-admin/detail.tsx` (lazy) | same (259) | — | 06 FE-P-620 |
| FE-R-055 | `/filter-cleaning-profiles` | `routes/filter-management/cleaning-profile-list.tsx` (lazy) | FCP_READ \| CP_TOGGLE \| CP_PAGE_{CREATE,EDIT,DELETE} \| VERSION_HISTORY_VIEW (260) | `cleaning-profiles` | 03 FE-P-306 |
| FE-R-056 | `/filter-cleaning-profiles/:id/edit` | `routes/filter-management/cleaning-profile-editor.tsx` (lazy) | FCP_UPDATE \| CP_PAGE_EDIT (261) | — | 03 FE-P-307 |
| FE-R-057 | `/filters/:id/operate` | `filter-operations.tsx` (same component; `:id` is never read) | FILTER_OPERATE \| ASSET_READ (263) | — | 03 FE-P-303 |
| FE-R-058 | `/filters/:id/trace` | `routes/filter-management/filter-traceability.tsx` (lazy) | EVENT_READ \| ASSET_READ \| CYCLE_READ (264) | — | 03 FE-P-305 |
| FE-R-059 | `/cleaning-cycles` | `routes/cleaning-cycles/history.tsx` (lazy) | CYCLE_READ \| VERSION_HISTORY_VIEW (265) | `cleaning-cycles` (Reports) | 07 FE-P-705 |
| FE-R-060 | `/cleaning-cycles/:id` | `routes/cleaning-cycles/timeline.tsx` (lazy) | same (266) | — | 07 FE-P-706 |
| FE-R-061 | `/filter-lifecycle-report` | `routes/cleaning-cycles/filter-lifecycle.tsx` (lazy) | CYCLE_READ (270) | `filter-lifecycle-report` (Reports) | 07 FE-P-707 |
| FE-R-062 | `/config/filter-setup` | `routes/config/filter-setup.tsx` (lazy) | SA (271) | — | 05 FE-P-527..530 |
| FE-R-063 | `/config/equipment-groups` | `routes/config/equipment-groups.tsx` (lazy) | EG_VIEW \| ASSET_READ (273) | `equipment-groups` | 04 FE-P-409 |
| FE-R-064 | `/config/ahu-filter-set-config` | `routes/config/ahu-filter-set-config.tsx` (lazy) | PM_READ \| ASSET_VIEW (274) | — (no card on `/config` either) | 05 FE-P-531 |
| FE-R-065 | `/pm-schedules` | `routes/pm-schedules/index.tsx` (lazy) | PM_READ \| PM_CREATE \| PM_UPDATE \| PM_DELETE \| PM_EXECUTE \| PM_APPROVE (275) | `pm-schedules` | 07 FE-P-701 |
| FE-R-066 | `/pm-schedules/:entityId` | `routes/pm-schedules/detail.tsx` (lazy) | same (276) | — | 07 FE-P-702 |
| FE-R-067 | `/my-tasks` | `routes/my-tasks/index.tsx` (lazy) | PM_READ \| PM_EXECUTE \| PM_APPROVE (277) | `my-tasks` | 07 FE-P-703 |
| FE-R-068 | `/deviations` | `routes/deviations/index.tsx` (lazy) | PM_READ \| PM_APPROVE (278) | `deviations` (Reports) | 07 FE-P-704 |
| FE-R-069 | `/ahus/:id` | `routes/filter-management/ahu-dashboard.tsx` (lazy) | ASSET_VIEW (279) | — (linked from Filters table) | 03 FE-P-304 |
| FE-R-070 | `/audit` | `routes/audit/index.tsx` (lazy) | AUDIT_READ (280) | `audit` | 06 FE-P-610 |
| FE-R-071 | `/report-reviews` | `routes/report-reviews/index.tsx` (lazy) | REPORT_REVIEW_SUBMIT \| REPORT_REVIEW \| REPORT_APPROVE (281) | `report-reviews` | 07 FE-P-711 |
| FE-R-072 | `/stage-approvals` | `routes/stage-approvals/index.tsx` (lazy) | STAGE_APPROVAL_VIEW \| STAGE_APPROVAL_DECIDE (282) | `stage-approvals`; also the tablet's Stage Approvals tab under `/m` | 07 FE-P-710, 01 FE-P-109 |
| FE-R-073 | `/admin-requests` | `routes/admin-requests/index.tsx` (lazy) | ADMIN_REQUEST_APPROVE \| ADMIN_REQUEST_REJECT (283) | `admin-requests` | 07 FE-P-709 |
| FE-R-074 | `/version-history` | `routes/version-history/index.tsx` (lazy) | VERSION_HISTORY_VIEW (288) | `version-history` | 06 FE-P-617 |
| FE-R-075 | `/hierarchy-preview` | `routes/hierarchy-preview/index.tsx` (lazy) | ASSET_READ (291); self-described "dev-only" | — | 06 FE-P-618 |
| FE-R-076 | `*` | `<Navigate to="/" replace />` | — (296) | — | n/a (redirect) |

Sidebar items with no dedicated route row above: none. Every one of the 27 `SIDEBAR_ITEMS` hrefs in `sidebar.tsx` resolves to a route in this table.

## 4. Shared behaviour components (read directly for this merge)

- **Route guard** `components/require-role.tsx:9-61`: SUPER_ADMIN bypass → role match → any-permission match → "Access Denied" panel. There is no per-route redirect; denied users stay on the URL.
- **API client** `lib/api-client.ts`: token from `sessionStorage.access_token` (`:24`); mutating calls refused with `code:'HARD_CUTOFF'` once the offline hard-cutoff elapsed, except login/refresh (`:11-20, 31-36`); `REAUTH_REQUIRED`/`REAUTH_FAILED` re-thrown untouched for the dialog (`:66-68`); `FORCE_PASSWORD_CHANGE`/`PASSWORD_EXPIRED` hard-redirect to `/change-password` unless already there (`:75-80`); any other 401 wipes session + single-tab keys and redirects to `/login` or `/m/login` with **no returnUrl** (`:82-102`); `delete()` always sends a JSON body for the Android `HttpURLConnection` Content-Type quirk (`:146-163`); re-auth variants send the password in both `x-reauth-password` header and `_currentPassword` body (`:165-194`); single in-flight `refreshToken()` (`:219-245`). 23 raw `fetch(` call sites in `routes/` bypass all of this (F8).
- **App shell** `components/layout/app-layout.tsx`: RFID keyboard guard (`:22`), drag-scroll (`:23`), offline-cache config (`:27`), SUPER_ADMIN API kill-switch lockdown screen (`:184-186`), idle-timeout warning dialog driven by `/api/config/password-policy/current` (`:35-46, 208-244`), duplicate-tab / different-user screens via BroadcastChannel/localStorage heartbeat (`:94-179`), `/api/sync/since` versioned-cache poll every 60 s only for roles with ASSET_VIEW or FILTER_OPERATE (`:61-68`), `HardCutoffBlocker` (`:201`) and `FailedOpsPanel` (`:205`) mounted globally.
- **Sidebar** `components/layout/sidebar.tsx:253-314`: SUPER_ADMIN sees all; `quality-notifications` hidden until `/api/pm-schedules/qnn/visible` (`:276`); then `isSidebarItemVisible(id, perms)` over `PERMISSION_TREE`; then `config.sidebarItems` allow-list from `/api/config/my-config` which also sets the display order (`:289-298`); Reports group auto-expands on an active child (`:311-314`).
- **Re-auth hook** `hooks/use-reauth.ts`: gated set from `/api/config/action-reauth/my-actions` (`:40-43`); `execute` **does not re-throw** — failures reach only `onError`, cancel reaches `onCancel` or falls back to `onError({error:'REAUTH_CANCELLED', message:'Cancelled — …'})` (`:188-215`); `executeWithResult` rejects instead (`:127-153`); a backend `REAUTH_REQUIRED` on an ungated call opens the dialog retroactively (`:100-108`). This is the mechanism behind every "cancel shows as a red error" row in the parts.
- **Date range** `components/ui/date-range-filter.tsx`: `checkRangeEdge` rejects an inverting edit with a 4-second hint, never calls the sibling `onChange`, uses `>`/`<` so same-day ranges pass (`:59-75, 130-142`); native `min`/`max` are UX only (`:185, 198`). The Audit Trail filter borrows `checkRangeEdge` with its own markup.
- **RFID scan normaliser** `lib/rfid-scan.ts:11-27`: trim, strip CR/LF/TAB, upper-case, collapse doubled and tripled EPCs. Imported by exactly four files (F9). Paths that still store or compare raw scans: Filters page RFID panel and SA edit (02/S-5), tablet RFID Assign / Replace-scan / Replacement-task scan (01/#8).
- **Searchable select** `components/ui/searchable-select.tsx` (used for AHU/Filter pickers on tablet Status and Filters pages) and **export menu** `components/ExportMenu.tsx` (fail-open while `/api/config/export-options/current` loads, 02/S-12, 07/#32) are documented at the call sites in the parts.
- **Error surfacing**: `components/toast-provider.tsx` + `hooks/use-toast.ts` (signature `(title, message?)` — see 06/S-27 for a title/message swap), `components/ui/error-popup.tsx` (priority dialog used by Filter Operations), `components/pwa-reload-prompt.tsx` mounted at root for SW updates.

## 5. Consolidated suspicious / dead controls

Every finding below is quoted with file:line in the part it comes from (the "Part ref" column). "Verdict" is this merge's own spot-check: the handler or mount was re-read in source before the row was accepted (commands F11-F12). Rows are grouped by the kind of risk a QA campaign has to plan for; the parts hold a further ~190 lower-severity rows (cosmetic, naming, unused imports, UX inconsistencies) that are not repeated here.

### 5.1 Controls that do nothing, or can never be reached

| # | Finding | Where | Part ref | Verdict |
|---|---|---|---|---|
| C-01 | **"Send for Review" button is dead on 10 pages.** `SEND_FOR_REVIEW_ENABLED = false` → `return null`. Consequence: `POST /api/report-reviews` has no live caller, so the Report Reviews page (`/report-reviews`) can only be fed by API. | `components/SendForReviewButton.tsx:23,69`; mounted on Filters, Audit, PM, Deviations, Cleaning Record, Timeline, Lifecycle, Replacement Schedule, RFID Track, QNN | 02/S-1, 06/S-02, 07/#1, 03/FE-P-308-S5 | **Confirmed** (constant + early return read; 10 mounts counted, F6). Do not write test cases for it. |
| C-02 | **"Swap Sets" on AHU Dashboard** is permanently `disabled`, `title="Coming soon"`, no handler. | `routes/filter-management/ahu-dashboard.tsx:90-92` | 03/FE-P-304-S1 | **Confirmed** (only `disabled` + `title`, no `onClick`). |
| C-03 | **Role Assignments offers two "not yet implemented" task-visibility options** (`PER_USER`, `ROLE_GATED`) that are saveable; the page itself warns "the task list will error". | `routes/config/role-assignments.tsx:536-541` | 05/S-01 | **Confirmed** (option values present and Save All sends the key). |
| C-04 | **~500 lines of the tablet `MobileOperationsPage` are unreachable** (own header, Home/Status/My Tasks/Cycles views): the sole mount passes `hideHeader`, and `view='home'` is only set by the hidden header's back button. Two SWR keys inert. | `routes/mobile/mobile-wrapper.tsx:2003`; `mobile-operations.tsx:3590, 831` | 01/#1, FE-P-118, FE-A-1102 | **Confirmed** (`<MobileOperationsPage … hideHeader />` is the only mount; `setView('home')` only at `:831`). |
| C-05 | **Web `DryerDurationDialog` + `handleDryerDurationSubmit` are unreachable**: no `open_dryer` dispatch exists on the web page (only in `mobile-operations.tsx:2187`); `lib/filter-ops/dialog-state.ts:259-267` can derive `awaiting_dryer` but is a documented stub with no caller. Web Dry In uses the queue-header duration select instead. | `routes/filter-management/filter-operations.tsx:232-238, 1343-1405` | 03/FE-P-302-S3 | **Confirmed** (grep: `open_dryer` only in dialog-state.ts definition and mobile-operations). |
| C-06 | **`/filters/:id/operate` ignores `:id`** — renders the plain landing grid (`useParams` reads `stageKey` only). | `filter-operations.tsx:59`; `main.tsx:263` | 03/FE-P-303-S1 | **Confirmed** (`const { stageKey: urlStageKey } = useParams…`). |
| C-07 | **Filter Data Management "generic tab" branch is dead** (`genericTabs = []`); its Save would PUT with no `_changeReason` and no re-auth ("Record updated silently"). Also `tab === 'audit-trail'` mutate branch unreachable. | `routes/config/filter-data-management.tsx:659, 2213-2231, 1335` | 04/S3, S4 | **Confirmed**. Dangerous only if re-enabled. |
| C-08 | **Dead handlers/state**: Debug Traces `handleToggleEntityTracing` (no JSX caller); Users `bulkDeleting` never set true (dialog's "Deleting…"/disabled guard never engages → double-click can fire two bulk deletes); contact-admin `canSubmit()` never called; FDM `unretireParentId` has no input; filter-list `createFilterProfile` always `''`. | `routes/debug/index.tsx:178`; `routes/users/list.tsx:46`; `routes/auth/contact-admin.tsx:131-147`; `filter-data-management.tsx:525`; `filter-list.tsx:221-225` | 06/S-07, S-06, S-08; 04/S10; 02/S-3 | **Confirmed** for debug toggle and `setBulkDeleting` (single definition each, no call site). |
| C-09 | **No "Verify Chain" control anywhere in the UI** although the audit-delete dialog copy refers to it; `GET /api/audit/verify-chain` has no frontend caller. | `routes/audit/components/audit-delete-dialog.tsx:27` | 06/S-01 | **Confirmed** (3 comment-only hits for `verify-chain`). |
| C-10 | **Inert filters**: FDM date range on the Block Changes tab (key omits from/to); Deviations From/To filters only the export, not the list; FDM `action` param for audit tab never set; `httpGatewayHeaders` has no input; password-policy `require*` booleans have no control. | `filter-data-management.tsx:726`; `routes/deviations/index.tsx:352-360, 202-207`; `email-settings.tsx:66`; `password-policy.tsx` | 04/S5, S7, S35; 07/#13; 05/S-23 | Accepted on the part's quoted evidence; not re-read. |
| C-11 | **Hover-only controls on touch surfaces**: Structure-tab canvas Add Area / Add AHU / Edit / Delete, cleaning-profile editor node "×", checklist list Delete. | `HierarchyCanvas.tsx:298`, `HierarchyDiagram.tsx:116,159`; `cleaning-profile-editor.tsx:432`; `checklist-admin/list.tsx:201` | 02/S-7; 03/FE-P-307-S2; 06/S-05 | Accepted (class strings quoted). Test on tablet. |
| C-12 | **Debug control shipped in production**: tablet RFID keystroke-debug toggle is always rendered (`fixed bottom-4 right-4 z-[60]`) and its log captures every keydown on the stage view. | `routes/mobile/mobile-operations.tsx:3684-3705, 391` | 01/#2 | **Confirmed** (button rendered unconditionally). |
| C-13 | Stale vocabularies: Debug Traces offers `MQTT/HTTP/WEBSOCKET/DLQ` filters for subsystems removed in Phase 7; Help categories include `connectivity`/`uns` and omit the categories seed data uses; Cleaning Profiles list colours `FLEXIBLE/LINEAR` while the editor writes `BYPASS_ENABLED`. | `routes/debug/index.tsx:273,288-290`; `help.tsx:46-54`; `cleaning-profile-list.tsx:13-17` | 06/S-21; 04/S22; 03/FE-P-306-S1 | Accepted (quoted). |

### 5.2 Gated endpoints called without a re-auth path (the 🔴 CLAUDE.md anti-pattern)

| # | Finding | Where | Part ref | Verdict |
|---|---|---|---|---|
| R-01 | **Replacement Schedule upload/validate/template are raw `fetch` with no `reauth.execute`**, while the server enforces `UPLOAD_REPLACEMENT_SCHEDULE` (`apps/api/src/modules/replacement-schedule/routes.ts:76`). With that row enabled the upload fails as a bare 401 message in the dialog. | `routes/filter-management/replacement-schedule.tsx:281, 298, 310` | 03/FE-P-308-S1 | **Confirmed** (the only `reauth.execute` calls in the file are review/approve/reject at `:173,182,194`). |
| R-02 | **Pagination settings Save has no `useReauth`/`ReauthDialog`**, but `pagination.def.ts:12-14` declares `requiresReauth: true, reauthAction: 'UPDATE_CONFIG_PAGE'`. | `routes/config/pagination.tsx:103` | 05/S-02 | **Confirmed** (0 re-auth references in the file; def read). |
| R-03 | **Filter Data Management: three mutations bypass `gated()`** — unretire and both manual retirement/replacement record creates call `apiClient.post` directly; backend routes carry `requireDataEditReauth`. | `filter-data-management.tsx:839, 1275, 1285` | 04/S1 | **Confirmed** (lines read). |
| R-04 | **Tablet Access page has no write gate** although the route admits CONFIG_READ-only roles; toggles and Save are live and end in a 403 toast after the password prompt. | `routes/config/tablet-access.tsx:146-200`; `main.tsx:255` | 05/S-04 | **Confirmed** (grep for `canWrite`/`CONFIG_UPDATE`/`isSuperAdmin` in the file: none). |
| R-05 | Admin Requests signs **Reject under `APPROVE_ADMIN_REQUEST`**; no separate reject row. Report Reviews "Download PDF" writes **no `/api/audit/report-export-log`** and takes no export re-auth. Notification templates create/update/delete have **no re-auth** client or server. | `routes/admin-requests/index.tsx:150`; `routes/report-reviews/index.tsx:123-125` + `lib/report-review.ts:62-67`; `notification-rules/index.tsx:706-727` | 07/#21, #2; 04/S27 | **Confirmed** for report-review download (0 export-log references in the two files). Others accepted on quoted code. |
| R-06 | Single-filter `core.startAndAdvance`/`core.advance` on the web stage screen pass no password and are not wrapped in `signOnce`; a `REAUTH_REQUIRED` reaches the error popup, not the prompt (batch paths are wrapped). | `filter-operations.tsx:1220-1227, 1531-1553` | 03/FE-P-302-S9 | Accepted as "UNVERIFIED runtime"; the part did not read `use-core.ts` internals. QA: enable `START_CLEANING_CYCLE` row for an operator and start one filter from the web. |

### 5.3 Flows that can hang, mis-route or destroy data

| # | Finding | Where | Part ref | Verdict |
|---|---|---|---|---|
| F-01 | **Web stage screen (`/filters/stage/:key`) does not render `PmPendingTasksDialog`, `AhuSetChooserDialog` or `RemainingFiltersDialog`** — they are mounted only in the landing-page return. A 409 `PM_PREVIOUS_TASK_PENDING`, a both-sets AHU, or an AHU-completion POPUP/INTERLOCK on that screen leaves the submit awaiting a promise that no dialog can resolve (`loading` stuck). | `filter-operations.tsx:1873` (stage return) vs `:2213, 2229, 2249` (mounts inside the `:1991` return) | 03/FE-P-302-S1 | **Confirmed structurally** (returns at 1864/1873/1991; the three dialogs mount only after 1991). Runtime still UNVERIFIED — highest-priority QA scenario. |
| F-02 | **FDM lifecycle-step Delete resolves the endpoint from the active tab** (`cleaning-cycles`), so confirming sends `DELETE /api/super-admin/data/cleaning-cycles/<eventId>`. Expected 404; worst case wrong-row deletion if ids ever collide. | `filter-data-management.tsx:1824` → `:1302-1310` | 04/S2 | **Confirmed** (`onDeleteEvent` sets `{id: ev.id}`; `handleDeleteGeneric` has no event branch when `tab === 'cleaning-cycles'`). |
| F-03 | **Destructive actions without confirmation**: single Notification delete (row trash), Filters "Resubmit" row button, FailedOpsPanel Dismiss / Dismiss all (drops queued §11 offline work), Sidebar "Reset to Role Default", web/tablet "Clear" of the pending offline queue via native `confirm`. | `notifications/index.tsx:712-723`; `filter-list.tsx:2067`; `components/failed-ops-panel.tsx:71-88`; `sidebar-tab.tsx:113-122`; `filter-operations.tsx:1886, 2006`; `mobile-wrapper.tsx:1193` | 06/S-18; 02/S-11; 01/#15; 05/S-19; 03/FE-P-302-S8 | Accepted (quoted). |
| F-04 | **Required `SIGNATURE` checklist question can never be answered on the tablet** (placeholder text, no input) → required check blocks the whole batch. | `mobile-operations.tsx:4537, 3228` | 01/#3 | Accepted (quoted). Web checklist-dialog has no SIGNATURE widget either (grep 0 hits) — same dead-end if such a question exists. |
| F-05 | **Tablet-access gating is skipped offline** (allowlist fetch keyed on `online`, `hasFeature = !configured || …`), and `mobile-operations.tsx:120` uses a different allowlist rule than `:3583`. | `mobile-wrapper.tsx:158-161`; `mobile-operations.tsx:120, 3583` | 01/#6 | Accepted (quoted). |
| F-06 | **Backup file picker excludes `.dump`** (`accept=".json,.bak,.sql,.zip"`) although DUMP is the recommended format and the backend restores it. | `routes/config/backup.tsx:425` | 04/S18 | Accepted (quoted). |
| F-07 | **Self-approval exclusions only hide the checkbox**, not the per-row Review/Approve buttons (PM and Replacement Schedule); server refuses after the password. Comparison uses `submittedByName !== user.username` (name vs username UNVERIFIED). | `pm-schedules/index.tsx:686-692 vs 1052,1068`; `replacement-schedule.tsx:153-156` | 07/#8; 03/FE-P-308-S4 | Accepted. |
| F-08 | **PM Schedule "Start PM" and QNN page have no frontend permission gate** (backend `PM_EXECUTE` / `canSeeQnn` 403 after the fact); `/quality-notifications` has no `RequireRole` at all and the list SWR fires before the visibility check. | `pm-schedules/detail.tsx:167-172`; `main.tsx:247`; `quality-notifications.tsx:58,71` | 07/#9; 03/FE-P-312-S1 | **Confirmed** for `main.tsx:247` (bare `<Suspense>`). |
| F-09 | **Unhandled promise rejections on cancelled export re-auth** (`requireExportReauth` throws, handlers have no `catch`): Filters PDF/Excel, Cleaning Record, Cycle Timeline, RFID Track, QNN. `isReauthCancelled` is imported but unused in 5 files. | `filter-list.tsx:1548-1556, 1575-1581`; `history.tsx:314-343`; `timeline.tsx:86-120`; `rfid-track-record.tsx:196-216`; `quality-notifications.tsx:144-164` | 02/S-6; 07/#3; 03/FE-P-311-S2 | **Confirmed** for filter-list (handlers read: `await requireExportReauth(...)` with no try/catch). |
| F-10 | **Cancelled password prompt rendered as an error** ("Cancelled — password confirmation was not completed." in red banners / `toast.error`) wherever `reauth.execute` is used without `onCancel`: 8 tablet actions, backup export/restore, help dialogs, single-filter cycle start. | `hooks/use-reauth.ts:211`; callers listed in 01/#5, 04/S20, S23 | 01/#5; 04/S20, S23 | Mechanism confirmed in `use-reauth.ts:188-215`. |
| F-11 | **Swallowed failures on user-visible actions**: notification-rules group create/delete/add/remove (`catch { return; }`), tablet notification mark-read (`catch { /* ignore */ }`), role-assignments initial load (403 → `{}` then Save All PUTs partial object), audit-templates save error dropped, contact-admin roles fetch `.catch(() => {})`, PM "existing schedule?" probe. | `notification-rules/index.tsx:559-600`; `mobile-wrapper.tsx:340-343`; `role-assignments.tsx:243-244`; `audit-templates.tsx:84`; `contact-admin.tsx:96-103`; `pm-schedules/index.tsx:569` | 04/S26; 01/#4; 05/S-11, S-10; 06/S-09; 07/#11 | Accepted (quoted). |
| F-12 | **Export truncation / limit mismatches**: RFID Track and QNN exports hard-cap at 500 rows while the subtitle shows the server total; Lifecycle PDF ignores `useExportLimit` (hard `MAX_CYCLES = 400` / no cap for broad scope); PM Excel export ignores on-screen status/date filters and checks the limit on the unfiltered set. | `rfid-track-record.tsx:127`; `quality-notifications.tsx:95`; `filter-lifecycle.tsx:580-816`; `pm-schedules/index.tsx:329-343` | 03/FE-P-311-S1; 07/#16, #6 | Accepted (quoted). |
| F-13 | **Role management**: Delete button rendered for system roles despite the banner; `isSuperAdmin` variable is true for any `ROLE_MANAGE` holder; Permissions/Sidebar saves never `mutate` the role-config SWR keys. | `role-table.tsx:95-104`; `role-access.tsx:45`; `permissions-tab.tsx:47-61`; `sidebar-tab.tsx:90-111` | 05/S-15, S-17, S-18 | **Confirmed** for role-table (only `isSystem` reference is the badge at `:69`). |
| F-14 | **Compliance text contradictions**: FDM create dialog says "not written to the audit trail" while the backend writes `MANUAL_RECORD_CREATED`; Backup tooltip names `BACKUP_MANAGE` while the gate also accepts `BACKUP_EXPORT`; filter-list re-auth prompt always says "Update Status" for 18 different signed actions. | `filter-data-management.tsx:2523`; `backup.tsx:378,391`; `filter-list.tsx:2295` | 04/S9, S21; 02/S-2 | **Confirmed** for `filter-list.tsx:2295` (`actionLabel="Update Status"`). |

### 5.4 Load / performance patterns worth knowing during the load test

- Tablet Status / RFID Assign / Replace views fetch **every cycle with events** (`/api/filters/cycles?limit=ALL_ROWS&includeEvents=true`) for a "Last Cleaned" fallback (01/#9).
- Dashboard drill-down and PM Schedules list pull the **whole `/api/assets/instances`** table client-side (06/S-15; 07/#12); Equipment Groups edit downloads every in-progress cycle just to count references (04/S41); Admin Requests polls the whole table every 15 s with no pagination (07/#24).
- FDM search is client-side over the current server page on 6 server-paginated tabs while the header shows the server total (04/S6).
- Six pages hard-code page sizes instead of `usePaginationDefaults()` (03/FE-P-309-S1; 06/S-20; 03/FE-P-311-S3).

### 5.5 Checked and found clean

- `console.log/debug/info`: 0 in production paths (F5). `console.warn/error` sites are enumerated per part (all intentional, mostly offline-grant and cache-write failures).
- SWR keys built from user input: every flagged key (`/api/audit?${params}`, `/api/notifications?${params}`, `/api/users?${params}`, `/api/pm-schedules/deviations?${params}`, notification logs, RFID track, QNN) uses `URLSearchParams` or `encodeURIComponent` — not a finding (02/S-16, 04/S8, 06/S-38, 07/#35, 03/FE-P-311-S4). Remaining interpolations are route UUIDs or fixed enums.
- Links to routes that do not exist in `main.tsx`: none from page code. The only dangling targets are 11 `customPagePath` values in backend `*.def.ts` files that `config/index.tsx:581` would link to if a filter changed (05/S-07).
- `TODO`/`FIXME`/"coming soon"/"not yet implemented" text: only the two rows in C-02 and C-03.

## 6. Footnotes — commands behind every count

All run from `apps/web/src` unless noted; test files excluded with `grep -v __tests__`.

- F1 (per-part rows): `for f in QA/_discovery/parts/0*.md; do grep -cE "^\| FE-P-[0-9]+ " $f; grep -cE "^\| FE-D-[0-9]+ " $f; grep -cE "^\| FE-F-[0-9]+ " $f; grep -cE "^\| FE-A-[0-9]+" $f; awk '/^## Tables/{p=1} /^## Suspicious/{p=0} p' $f | grep -cE "^\| FE-"; awk '/^## Suspicious/{p=1} /^## Footnotes/{p=0} p' $f | grep -cE "^\| "; done`
- F2 (routes): `grep -cE "<Route\b" main.tsx` → 76; `grep -cE "<Route path=" main.tsx` → 75; `grep -c "<Routes>" main.tsx` → 1 (why the plain `grep -c "<Route"` says 77); `grep -c RequireRole main.tsx` → 63; `grep -c "lazy(() =>" main.tsx` → 48.
- F3 (files/lines): `find routes -type f \( -name "*.tsx" -o -name "*.ts" \) -not -path "*__tests__*" | wc -l` → 160; `wc -l` over the same set → 60,092; `ls routes/config/*.tsx | wc -l` → 34.
- F4 (controls): `grep -rnoE "<(button|Button)\b" routes components --include=*.tsx | grep -v __tests__ | wc -l` → 836; `… "onClick=" …` → 908; `… "<form\b" …` → 12; `… "<(input|Input|select|Select|textarea|SearchableSelect)\b" …` → 507; `grep -rnE "fixed inset-0" routes components --include=*.tsx | grep -v __tests__ | wc -l` → 74; `grep -rnE "<(Dialog|Modal|ConfirmDialog|MessageDialog|ErrorPopup)\b" routes components --include=*.tsx | grep -v __tests__ | wc -l` → 26.
- F5 (data/logging): `grep -rnoE "\buseSWR\b" routes components hooks --include=*.tsx --include=*.ts | grep -v __tests__ | wc -l` → 377; `grep -rnoE "\b(api|apiClient)\.(get|post|put|patch|delete)\b" routes components hooks lib … | wc -l` → 271; `grep -rnE "console\.(log|debug|info)\(" routes components hooks lib … | wc -l` → 0; `grep -rnoE "refreshInterval:" … | wc -l` → 35; `grep -rnoE "setInterval\(" … | wc -l` → 16.
- F6 (re-auth / dead button): `grep -rlE "useReauth\(" routes components --include=*.tsx | grep -v __tests__ | wc -l` → 68; `grep -rnoE "<(ReauthDialog|ReauthPrompt)\b" … | wc -l` → 74; `grep -rln "<SendForReviewButton" routes --include=*.tsx | wc -l` → 10; `grep -n "SEND_FOR_REVIEW_ENABLED" components/SendForReviewButton.tsx` → `:23 = false`, `:69 return null`.
- F7 (native dialogs): `grep -rnoE "\b(window\.)?(confirm|alert|prompt)\(" routes components --include=*.tsx | grep -v __tests__ | wc -l` → 22.
- F8 (raw fetch): `grep -rnE "\bfetch\(" routes --include=*.tsx | grep -v __tests__ | wc -l` → 23.
- F9 (RFID normaliser): `grep -rl "normalizeRfidScan" routes components hooks lib --include=*.tsx --include=*.ts | grep -v __tests__` → 4 files + `lib/rfid-scan.ts`.
- F10 (route coverage): `grep -oE '<Route path="[^"]+"' apps/web/src/main.tsx | sed -E 's/<Route path="//; s/"$//' | while read p; do grep -lF -- "\`$p\`" QA/_discovery/parts/0*.md || grep -lF -- "$p" QA/_discovery/parts/0*.md; done` → every path matched at least one part (`/` and `*` match trivially; `/` is inventoried as 06 FE-P-613).
- F11 (spot checks, dead controls): `grep -nE "^\s*return \(|<PmPendingTasksDialog|<AhuSetChooserDialog|<RemainingFiltersDialog|<StageScanDialog" routes/filter-management/filter-operations.tsx`; `sed -n '390,393p;1302,1312p;1822,1825p' routes/config/filter-data-management.tsx`; `grep -n setBulkDeleting routes/users/list.tsx`; `grep -n handleToggleEntityTracing routes/debug/index.tsx`; `grep -n "open_dryer\|awaiting_dryer" routes/filter-management/filter-operations.tsx lib/filter-ops/*.ts`; `sed -n '2003p' routes/mobile/mobile-wrapper.tsx; sed -n '3590p' routes/mobile/mobile-operations.tsx`; `grep -n isSystem routes/config/roles-components/role-table.tsx`; `grep -rn "verify-chain" routes components hooks lib`.
- F12 (spot checks, gates): `grep -c "useReauth\|ReauthDialog\|ReauthPrompt" routes/config/pagination.tsx` → 0 + `grep -n "requiresReauth\|reauthAction" apps/api/src/modules/config/defs/pagination.def.ts`; `sed -n '839p;1275p;1285p' routes/config/filter-data-management.tsx`; `grep -n "canWrite\|CONFIG_UPDATE\|isSuperAdmin" routes/config/tablet-access.tsx` → none; `grep -n "UPLOAD_REPLACEMENT_SCHEDULE\|reauth.execute" routes/filter-management/replacement-schedule.tsx`; `grep -n "report-export-log\|requireExportReauth" lib/report-review.ts routes/report-reviews/index.tsx` → none; `sed -n '1548,1556p;1575,1581p' routes/filter-management/filter-list.tsx`; `sed -n '2295p' routes/filter-management/filter-list.tsx`.
