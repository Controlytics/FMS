# 03 — API Endpoint Inventory

DigiLog / FMS API (Fastify, `apps/api`). One row per OpenAPI operation (**429 operations, 328 paths**), each matched to the source line that registers it. Read-only derivation; nothing was run against the API or the database.

## Summary

### Operations per load-test class

| Class | Count | Meaning |
|---|---|---|
| POLL | 30 | called on a timer by the web/tablet app |
| READ | 146 | GET, not polled |
| OP-WRITE | 49 | hot business writes: filter cleaning operations, PM, approvals, replacement, sync, guest/admin requests, auth session writes (login/logout/refresh/verify) |
| ADMIN-WRITE | 103 | config / roles / users / master-data writes (rare) |
| HEAVY | 22 | exports, bulk upload, bulk-operate, bulk delete/redact, backup/restore, verify-chain, xlsx/csv templates, multipart uploads |
| SA-ONLY | 79 | gated to SUPER_ADMIN only (and not HEAVY/POLL) |
| **Total** | **429** | |

Class precedence when several apply: POLL > HEAVY > SA-ONLY > OP-WRITE / ADMIN-WRITE / READ.

By method: GET 205, POST 104, PUT 87, PATCH 3, DELETE 30.

Audit column: 206 operations reach `auditLog()` (directly or traced), 223 do not, 0 undetermined (`?`).

### UNBOUNDED list endpoints (grow with data — matter most)

These return the whole result set: no `page`/`limit` in the query schema and no `take` in the handler/service.

| Method | Path | Class | Note | Source |
|---|---|---|---|---|
| GET | `/api/users/reset-requests` | READ | — | `modules/users/routes.ts:119` |
| GET | `/api/config/field-ids` | READ | — | `modules/config/static-routes/field-ids.routes.ts:11` |
| GET | `/api/config/roles` | READ | — | `modules/config/static-routes/roles.routes.ts:7` |
| GET | `/api/roles/` | READ | — | `modules/roles/routes.ts:28` |
| GET | `/api/roles/active` | READ | — | `modules/roles/routes.ts:60` |
| GET | `/api/roles/{name}/creatable` | READ | — | `modules/roles/routes.ts:362` |
| GET | `/api/assets/instances/tree` | READ | — | `modules/assets/routes/instance.routes.ts:175` |
| GET | `/api/assets/instances/pending-approval` | READ | findMany, no take — filter-approval.service.ts | `modules/assets/routes/instance.routes.ts:525` |
| GET | `/api/assets/instances/{id}/children` | READ | — | `modules/assets/routes/instance.routes.ts:814` |
| GET | `/api/assets/identifiers` | POLL | polled 30s mobile-operations.tsx:518; 60s mobile-wrapper.tsx:308 | `modules/assets/routes/identifier.routes.ts:11` |
| GET | `/api/help/` | READ | — | `modules/help/routes.ts:10` |
| GET | `/api/help/{id}/versions` | READ | — | `modules/help/routes.ts:328` |
| GET | `/api/notification-settings/templates` | READ | — | `modules/notification-delivery/routes.ts:645` |
| GET | `/api/user-groups/` | READ | — | `modules/user-groups/routes.ts:15` |
| GET | `/api/user-groups/{id}/members` | READ | — | `modules/user-groups/routes.ts:139` |
| GET | `/api/notification-rules/` | READ | — | `modules/notification-rules/routes.ts:40` |
| GET | `/api/super-admin/data/pm-schedules` | SA-ONLY | — | `modules/super-admin/routes.ts:1429` |
| GET | `/api/report-reviews/` | READ | svc.list findMany, no take | `modules/report-reviews/routes.ts:45` |
| GET | `/api/report-reviews/queue` | POLL | svc.queue findMany, no take; polled 30s | `modules/report-reviews/routes.ts:36` |
| GET | `/api/stage-approvals/queue` | POLL | svc.queue findMany, no take; polled 30s | `modules/stage-approvals/routes.ts:9` |
| GET | `/api/stage-approvals/` | READ | svc.list findMany, no take | `modules/stage-approvals/routes.ts:22` |
| GET | `/api/filter-cleaning-profiles/{id}/versions` | READ | per-lineage version history | `modules/cleaning-profiles/routes.ts:287` |
| GET | `/api/checklist-profiles/{id}/versions` | READ | — | `modules/checklist-profiles/routes.ts:99` |
| GET | `/api/filter-profiles/{id}/versions` | READ | per-profile version history | `modules/filter-profiles/routes.ts:50` |
| GET | `/api/pm-schedules/ahu-configs` | READ | one row per AHU | `modules/pm-schedules/routes.ts:290` |
| GET | `/api/pm-schedules/pending-tasks-map` | READ | map over every AHU | `modules/pm-schedules/routes.ts:611` |
| GET | `/api/pm-schedules/due` | POLL | window/date-range scoped; from/to optional; grouped by AHU with child filters; polled 30s my-tasks/index.tsx:94, mobile-operations.tsx:561; 30s/120s mobile-wrapper.tsx:331 | `modules/pm-schedules/routes.ts:625` |
| GET | `/api/pm-schedules/{entityId}/history` | READ | — | `modules/pm-schedules/routes.ts:752` |
| GET | `/api/filters/batch-states` | READ | getCurrentState for every active filter — batch-cache.ts | `modules/filter-operations/routes.ts:275` |
| GET | `/api/filters/retirements` | POLL | polled 30s | `modules/filter-operations/routes.ts:769` |
| GET | `/api/filters/replacements` | POLL | polled 30s | `modules/filter-operations/routes.ts:786` |
| GET | `/api/filters/cleaning-profiles/without-final-checklist` | READ | — | `modules/filter-operations/routes.ts:859` |
| GET | `/api/equipment-groups/` | READ | — | `modules/equipment-groups/routes.ts:31` |
| GET | `/api/equipment-groups/{id}/versions` | READ | per-group version history | `modules/equipment-groups/routes.ts:66` |
| GET | `/api/equipment-groups/by-block/{blockId}` | READ | scoped to one block; findMany, no take | `modules/equipment-groups/routes.ts:102` |
| GET | `/api/replacement-schedules/` | POLL | polled 30s | `modules/replacement-schedule/routes.ts:85` |
| GET | `/api/replacement-schedules/due` | READ | — | `modules/replacement-schedule/routes.ts:162` |
| GET | `/api/replacement-schedules/tasks` | POLL | polled 30s | `modules/replacement-schedule/routes.ts:173` |
| GET | `/api/replacement-schedules/blocked-filters` | POLL | id set; polled 30s | `modules/replacement-schedule/routes.ts:184` |
| GET | `/api/admin-requests/` | POLL | polled 15s | `modules/admin-requests/routes.ts:153` |
| GET | `/api/hierarchy/tree` | POLL | polled 30s | `modules/hierarchy/routes.ts:416` |

#### Paginated, but effectively unbounded

Every paginated endpoint below has **no `maximum` on `limit`** in its query schema (the super-admin `paginatedList` helper is explicit: "no page-size cap (operator decision 2026-09-04)", `modules/super-admin/routes.ts:858`). The web app asks several of them for `limit=ALL_ROWS`, and `ALL_ROWS = 1_000_000` (`apps/web/src/lib/page-size.ts:10`), so in practice they return the whole table:

| Endpoint | Called with `limit=ALL_ROWS` from (apps/web/src/…) | Polled? |
|---|---|---|
| `GET /api/filters/cycles (also `includeEvents=true`)` | routes/mobile/mobile-operations.tsx:569, routes/mobile/mobile-wrapper.tsx:351, routes/config/equipment-groups.tsx:168 | yes — 30s on the tablet |
| `GET /api/pm-schedules/entries` | routes/pm-schedules/index.tsx:214, :276 | yes — 15s, one request per year in the selected range |
| `GET /api/notifications` | routes/mobile/mobile-wrapper.tsx:335 | yes — 15s (notifications view) / 60s |
| `GET /api/users` | components/SendForReviewButton.tsx:38, components/super-admin-cycle-edit.tsx:59, routes/admin-requests/index.tsx:68, routes/audit/index.tsx:63, routes/config/filter-data-management.tsx:574, routes/config/notification-rules/index.tsx:209, :541, routes/deviations/index.tsx:115, routes/filter-management/quality-notifications.tsx:78, routes/filter-management/replacement-list.tsx:58, routes/filter-management/retirement-list.tsx:44, routes/filter-management/rfid-track-record.tsx:90, routes/notifications/index.tsx:152, routes/stage-approvals/index.tsx:73 (14 sites) | no |
| `GET /api/checklist-profiles` | lib/filter-ops/resolve-pending-checklist.ts:102, lib/offline-sync-service.ts:266, routes/checklist-admin/list.tsx:40, routes/filter-management/cleaning-profile-editor.tsx:51, routes/version-history/index.tsx:43 | no |
| `GET /api/filter-cleaning-profiles` | lib/offline-sync-service.ts:276, routes/config/cleaning-profile-assignment.tsx:46, routes/config/filter-data-management.tsx:760, routes/home/index.tsx:43, routes/version-history/index.tsx:37 | no |
| `GET /api/hierarchy/filters` | routes/filter-management/replacement-list.tsx:59 | the default-limit call is polled 30s (ahu-dashboard.tsx:53, filter-operations.tsx:89-91) |
| `GET /api/block-change-requests` | routes/mobile/mobile-operations.tsx:546 | no |
| `Filter Data Management generic tabs (`${endpoint}?limit=ALL_ROWS`)` | routes/config/filter-data-management.tsx:662 | no (SA-only page) |

All paginated endpoints (no max limit on any of them): `GET /api/users/`, `GET /api/audit/`, `GET /api/notifications/`, `GET /api/assets/templates`, `GET /api/assets/instances`, `GET /api/assets/identifiers/track-record`, `GET /api/notification-settings/logs`, `GET /api/super-admin/data/cleaning-cycles`, `GET /api/super-admin/data/filter-events`, `GET /api/super-admin/data/audit-trail`, `GET /api/super-admin/data/notifications`, `GET /api/super-admin/data/admin-requests`, `GET /api/super-admin/data/block-change-requests`, `GET /api/super-admin/data/pm-entries`, `GET /api/debug/traces/`, `GET /api/dashboards/`, `GET /api/filter-cleaning-profiles/`, `GET /api/checklist-profiles/`, `GET /api/filter-profiles/`, `GET /api/pm-schedules/qnn`, `GET /api/pm-schedules/entries`, `GET /api/pm-schedules/deviations`, `GET /api/filters/events`, `GET /api/filters/cycles`, `GET /api/filters/cleaning-record`, `GET /api/filters/manual-status-changes`, `GET /api/block-change-requests/`, `GET /api/hierarchy/blocks`, `GET /api/hierarchy/areas`, `GET /api/hierarchy/ahus`, `GET /api/hierarchy/filters`.

### HEAVY endpoints

| Method | Path | Auth | Re-auth | Source |
|---|---|---|---|---|
| POST | `/api/users/bulk-delete` | SUPER_ADMIN only | BULK_DELETE_USERS | `modules/users/routes.ts:81` |
| POST | `/api/audit/report-export-log` | authenticated (any role) + in-handler role logic | — | `modules/audit/routes.ts:467` |
| POST | `/api/audit/bulk-redact` | SUPER_ADMIN only | BULK_REDACT_AUDIT_RECORDS | `modules/audit/routes.ts:599` |
| POST | `/api/audit/bulk-delete` | AUDIT_DELETE | BULK_DELETE_AUDIT_RECORDS | `modules/audit/routes.ts:879` |
| GET | `/api/audit/verify-chain` | SUPER_ADMIN only | — | `modules/audit/routes.ts:952` |
| POST | `/api/uploads/photo` | authenticated (any role) | — | `modules/uploads/routes.ts:33` |
| POST | `/api/notifications/bulk-delete` | NOTIFICATION_DELETE | BULK_DELETE_NOTIFICATIONS | `modules/notifications/routes.ts:161` |
| GET | `/api/backup/export` | BACKUP_EXPORT | EXPORT_BACKUP | `modules/backup/routes.ts:17` |
| POST | `/api/backup/restore` | BACKUP_RESTORE | RESTORE_BACKUP | `modules/backup/routes.ts:101` |
| POST | `/api/backup/validate` | any: BACKUP_EXPORT, BACKUP_RESTORE | — | `modules/backup/routes.ts:228` |
| GET | `/api/assets/instances/filter-upload-template.xlsx` | any: ASSET_CREATE, FILTER_BULK_UPLOAD | — | `modules/assets/routes/instance.routes.ts:323` |
| POST | `/api/assets/instances/bulk-upload-filters` | any: ASSET_CREATE, FILTER_BULK_UPLOAD | [BULK_UPLOAD_FILTERS, CREATE_ASSET] | `modules/assets/routes/instance.routes.ts:438` |
| POST | `/api/assets/instances/bulk-upload-filters/validate` | any: ASSET_CREATE, FILTER_BULK_UPLOAD | — | `modules/assets/routes/instance.routes.ts:484` |
| POST | `/api/stage-approvals/bulk-decide` | STAGE_APPROVAL_DECIDE | computed `b.action === approve ? APPROVE_CLEANING_STAGE : REJECT_CLEANING_STAGE` — see modules/stage-approvals/routes.ts:106 (always) | `modules/stage-approvals/routes.ts:84` |
| GET | `/api/pm-schedules/template.csv` | any: PM_READ, PM_DOWNLOAD_TEMPLATE | — | `modules/pm-schedules/routes.ts:187` |
| POST | `/api/pm-schedules/upload` | any: PM_CREATE, PM_UPLOAD | UPLOAD_PM_SCHEDULES | `modules/pm-schedules/routes.ts:202` |
| GET | `/api/pm-schedules/entries/export.xlsx` | PM_READ | EXPORT_PM_SCHEDULE | `modules/pm-schedules/routes.ts:373` |
| POST | `/api/filters/bulk-operate` | FILTER_OPERATE | computed `reauthActionsForItems(items)` — see modules/filter-operations/routes.ts:691 | `modules/filter-operations/routes.ts:641` |
| GET | `/api/replacement-schedules/template.xlsx` | any: REPLACEMENT_SCHEDULE_VIEW, REPLACEMENT_SCHEDULE_UPLOAD | — | `modules/replacement-schedule/routes.ts:33` |
| POST | `/api/replacement-schedules/validate` | REPLACEMENT_SCHEDULE_UPLOAD | — | `modules/replacement-schedule/routes.ts:61` |
| POST | `/api/replacement-schedules/` | REPLACEMENT_SCHEDULE_UPLOAD | UPLOAD_REPLACEMENT_SCHEDULE | `modules/replacement-schedule/routes.ts:72` |
| GET | `/api/replacement-schedules/export.xlsx` | REPLACEMENT_SCHEDULE_VIEW | EXPORT_REPLACEMENT_SCHEDULE | `modules/replacement-schedule/routes.ts:94` |

`POST /api/audit/report-export-log` is itself a small audit write, but every report download calls it first (it is the `EXPORT_*` re-auth gate), so it scales with export volume.

### POLL endpoints (interval and where the web app polls them)

No global `refreshInterval` is set (`apps/web/src/lib/swr-config.ts:12`); every poll below is an explicit per-call `refreshInterval` or `setInterval`. SWR pauses polling while the tab is hidden (SWR default). File paths are under `apps/web/src/` unless shown in full.

| Method | Path | Interval — file:line | Result size |
|---|---|---|---|
| GET | `/api/health` | 15s, every client — apps/web/src/lib/connectivity.ts:147 (CONNECTIVITY_POLL_INTERVAL_MS, timing-constants.ts:30) | single record |
| POST | `/api/auth/refresh` | 30 min + 5s after mount — apps/web/src/hooks/use-auth.ts:226-229 | n/a (write) |
| GET | `/api/users/stats` | 30s — apps/web/src/routes/dashboard.tsx:83-84 | single record |
| GET | `/api/config/offline-cache/current` | 5 min — apps/web/src/hooks/use-offline-config.ts:33-42 | single record |
| GET | `/api/audit/` | 30s (limit=1) — apps/web/src/routes/dashboard.tsx:83,85 | paginated (page,limit), no max limit |
| GET | `/api/notifications/` | 30s (limit=1) dashboard.tsx:83,86; 15s/60s (limit=ALL_ROWS=1,000,000) mobile-wrapper.tsx:335 | paginated (page,limit), no max limit |
| GET | `/api/notifications/unread-count` | 30s — apps/web/src/components/layout/header.tsx:36-38 | single record |
| GET | `/api/roles/access-matrix` | 30s — routes/home/index.tsx:31-33 | single record (matrix, bounded by role count) |
| GET | `/api/assets/instances` | 30s — filter-operations.tsx:77, mobile/mobile-operations.tsx:498, mobile/mobile-wrapper.tsx:306 | paginated (page,limit), no max limit |
| GET | `/api/assets/identifiers` | 30s mobile-operations.tsx:518; 60s mobile-wrapper.tsx:308 | UNBOUNDED whole list |
| GET | `/api/system-health/` | 10s (auto-refresh on) — routes/system-health/index.tsx:126-127 | single record |
| GET | `/api/report-reviews/queue` | 30s — routes/report-reviews/index.tsx:32 | UNBOUNDED whole list (svc.queue findMany, no take) |
| GET | `/api/stage-approvals/queue` | 30s — routes/stage-approvals/index.tsx:127 | UNBOUNDED whole list (svc.queue findMany, no take) |
| GET | `/api/debug/traces/` | 10s — apps/web/src/routes/debug/index.tsx:94-96 | paginated (page,pageSize), no max limit |
| GET | `/api/debug/traces/stats` | 30s — apps/web/src/routes/debug/index.tsx:99-100 | single record |
| GET | `/api/pm-schedules/entries` | 15s, one request per year in range (limit=ALL_ROWS) — routes/pm-schedules/index.tsx:213-224 | paginated (page,limit), no max limit |
| GET | `/api/pm-schedules/deviations` | 30s — apps/web/src/routes/deviations/index.tsx:109 | paginated (page,limit), no max limit |
| GET | `/api/pm-schedules/due` | 30s my-tasks/index.tsx:94, mobile-operations.tsx:561; 30s/120s mobile-wrapper.tsx:331 | UNBOUNDED whole list (window/date-range scoped; from/to optional; grouped by AHU with child filters) |
| GET | `/api/filters/{id}/current-state` | 15s per drying filter — routes/filter-management/components/drying-filters-panel.tsx:314 | single record |
| GET | `/api/filters/retirements` | 30s — routes/filter-management/retirement-list.tsx:29 | UNBOUNDED whole list |
| GET | `/api/filters/replacements` | 30s — routes/filter-management/replacement-list.tsx:42 | UNBOUNDED whole list |
| GET | `/api/filters/cycles` | 30s (limit=ALL_ROWS, includeEvents=true) mobile-operations.tsx:569, mobile-wrapper.tsx:351-352 | paginated (page,limit), no max limit |
| GET | `/api/filters/dashboard-stats` | 20s — apps/web/src/routes/dashboard.tsx:87 | single record (aggregates — 9 count/groupBy) |
| GET | `/api/replacement-schedules/` | 30s — routes/filter-management/replacement-schedule.tsx:127 | UNBOUNDED whole list |
| GET | `/api/replacement-schedules/tasks` | 30s — mobile/mobile-wrapper.tsx:482 | UNBOUNDED whole list |
| GET | `/api/replacement-schedules/blocked-filters` | 30s — mobile/mobile-operations.tsx:531 | UNBOUNDED whole list (id set) |
| GET | `/api/sync/since` | 60s while online — apps/web/src/lib/sync-since.ts:249 (SYNC_SINCE_POLL_INTERVAL_MS) -> :131 | bounded (sync.service applies take on each findMany) |
| GET | `/api/admin-requests/` | 15s — apps/web/src/routes/admin-requests/index.tsx:115 | UNBOUNDED whole list |
| GET | `/api/hierarchy/filters` | 30s — routes/filter-management/ahu-dashboard.tsx:53, filter-operations.tsx:89-91 | paginated (page,limit), no max limit |
| GET | `/api/hierarchy/tree` | 30s — routes/filter-management/filter-list.tsx:251 | UNBOUNDED whole list |

Callouts:

- **`GET /api/stage-approvals/queue` writes on a GET** (`supersedeOrphan`, `modules/stage-approvals/service.ts:177-262`, which calls `auditLog`) and is polled every 30s by every open Stage Approvals page (web and tablet `/m`).
- **`GET /api/filters/{id}/current-state` is polled once per drying filter** (`drying-filters-panel.tsx:314`, 15s each), so its rate is (drying filters on screen) × 4/min per client.
- **`GET /api/health` is polled by every client every 15s** (`lib/connectivity.ts:147`) and runs `SELECT 1`. It is public.
- `GET /api/sync/since` is polled every 60s while online (`lib/sync-since.ts:249` -> `:131`). The offline sync engine also ticks every 30s (`lib/sync-engine.ts:815`) but only reads IndexedDB and sends requests when ops are queued, so it is not listed as a poll.
- Not counted as API polls: `components/failed-ops-panel.tsx:56` (8s, IndexedDB only), `hooks/use-single-tab.ts:147` (1s, localStorage heartbeat), `hooks/use-session.ts:106` (1s local timeout check), `components/pwa-reload-prompt.tsx:47` (60s service-worker update check, not an API route).

### Public endpoints (no JWT)

Source of truth: `PUBLIC_PATHS` / `PUBLIC_GET_PATHS` in `apps/api/src/plugins/auth.ts:180-194`, plus the explicit `POST /api/admin-requests` exception at `auth.ts:245`. Matching is segment-boundary, not bare prefix (`auth.ts:165-176`).

| Method | Path | Rate-limited | Source |
|---|---|---|---|
| GET | `/api/health` | no | `app.ts:577` |
| POST | `/api/auth/login` | 100/min | `modules/auth/routes.ts:19` |
| POST | `/api/auth/beacon-logout` | no | `modules/auth/routes.ts:187` |
| POST | `/api/auth/forgot-password` | no | `modules/auth/routes.ts:360` |
| GET | `/api/config/branding` | no | `modules/config/static-routes/branding.routes.ts:9` |
| GET | `/api/config/datetime/current` | no | `modules/config/routes.ts:183` |
| POST | `/api/guest/cleaning-request` | no | `modules/guest/routes.ts:13` |
| GET | `/api/roles/active` | no | `modules/roles/routes.ts:60` |
| GET | `/api/notification-settings/email/oauth2/code` | no | `modules/notification-delivery/routes.ts:259` |
| GET | `/api/admin-requests/user-lookup` | no | `modules/admin-requests/routes.ts:97` |

Public paths that are not in the OpenAPI spec: `GET /uploads/photos/*`, `GET /uploads/branding/*` (static files, `PUBLIC_GET_PATHS`), and `/docs` + `/docs/json` only while `API_DOCS=on` (`auth.ts:211-216`).

Discrepancy: CLAUDE.md calls `GET /api/config/password-policy/current` a "public endpoint", but it is in neither public list in `auth.ts`. It needs a token (it is only exempt from the forced-password-change block, `auth.ts:394`). It is marked authenticated below.

Rate limits (CLAUDE.md, `app.ts` `global: false`): only `POST /api/auth/login` (100/min), `/api/auth/verify` (50/min) and `/api/auth/change-password` (50/min). Every other route is unlimited.

## Inventory by module

Columns: **Auth gate** = `preHandler` gate(s); bare names are `requirePermission`, `any:` = `requireAnyPermission`, `role:` = `requireRole`. "authenticated (any role)" = no preHandler gate, so any valid JWT passes. "+ in-handler role logic" means the handler reads `req.user.role` or answers 403 itself, either to scope the data or to refuse. **Re-auth** = the action key(s) passed to `enforceReauth` (configurable per role on Config -> Action Re-auth), or `(always)` for `enforceReauthAlways`. **Audited write?** = whether the handler reaches `auditLog()` (see Method).

### Health (1)

Source: `apps/api/src/app.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/health` | PUBLIC | — | no | single record | POLL | 577 |

### admin-requests (5)

Source: `apps/api/src/modules/admin-requests/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin-requests/` | any: ADMIN_REQUEST_APPROVE, ADMIN_REQUEST_REJECT | — | no | UNBOUNDED whole list | POLL | 153 |
| POST | `/api/admin-requests/` | authenticated (any role) | — | yes (admin-request.service.ts create) | n/a (write) | OP-WRITE | 34 |
| GET | `/api/admin-requests/pending-count` | any: ADMIN_REQUEST_APPROVE, ADMIN_REQUEST_REJECT | — | no | single record | READ | 186 |
| GET | `/api/admin-requests/user-lookup` | PUBLIC | — | no | single record | READ | 97 |
| POST | `/api/admin-requests/{id}/process` | perm | APPROVE_ADMIN_REQUEST | yes (via process) | n/a (write) | OP-WRITE | 204 |

### assets (25)

Source: `apps/api/src/modules/assets/routes/identifier.routes.ts`, `apps/api/src/modules/assets/routes/instance.routes.ts`, `apps/api/src/modules/assets/routes/template.routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/assets/identifiers` | ASSET_VIEW | — | no | UNBOUNDED whole list | POLL | 11 |
| POST | `/api/assets/identifiers` | any: ASSET_IDENTIFIER_CREATE, FILTER_RFID_MANAGE | CREATE_ASSET_IDENTIFIER | yes (via create) | n/a (write) | ADMIN-WRITE | 111 |
| GET | `/api/assets/identifiers/lookup/{value}` | ASSET_VIEW | — | no | single record | READ | 89 |
| GET | `/api/assets/identifiers/track-record` | any: ASSET_VIEW, FILTER_RFID_MANAGE | — | no | paginated (page,limit), no max limit | READ | 50 |
| DELETE | `/api/assets/identifiers/{id}` | any: ASSET_IDENTIFIER_DELETE, FILTER_RFID_MANAGE | DELETE_ASSET_IDENTIFIER | yes (via delete) | n/a (write) | ADMIN-WRITE | 154 |
| GET | `/api/assets/instances` | ASSET_VIEW | — | no | paginated (page,limit), no max limit | POLL | 39 |
| POST | `/api/assets/instances` | any: ASSET_CREATE, FILTER_CREATE, FILTER_HIERARCHY_CREATE | [CREATE_ASSET, CREATE_FILTER] | yes (via create) | n/a (write) | ADMIN-WRITE | 269 |
| GET | `/api/assets/instances/approval-counts` | ASSET_READ | — | no | single record (counts) | READ | 543 |
| POST | `/api/assets/instances/approve` | FILTER_APPROVE | APPROVE_FILTER | yes (via auditEach) | n/a (write) | OP-WRITE | 576 |
| POST | `/api/assets/instances/bulk-upload-filters` | any: ASSET_CREATE, FILTER_BULK_UPLOAD | [BULK_UPLOAD_FILTERS, CREATE_ASSET] | yes (via bulkUploadFilters) | n/a (write) | HEAVY | 438 |
| POST | `/api/assets/instances/bulk-upload-filters/validate` | any: ASSET_CREATE, FILTER_BULK_UPLOAD | — | yes (via bulkUploadFilters) | n/a (write) | HEAVY | 484 |
| GET | `/api/assets/instances/filter-upload-template.xlsx` | any: ASSET_CREATE, FILTER_BULK_UPLOAD | — | no | file | HEAVY | 323 |
| GET | `/api/assets/instances/pending-approval` | any: FILTER_REVIEW, FILTER_APPROVE, ASSET_READ | — | no | UNBOUNDED whole list (findMany, no take — filter-approval.service.ts) | READ | 525 |
| POST | `/api/assets/instances/reject` | any: FILTER_REVIEW, FILTER_APPROVE | REJECT_FILTER | yes (via auditEach) | n/a (write) | OP-WRITE | 591 |
| POST | `/api/assets/instances/review` | FILTER_REVIEW | REVIEW_FILTER | yes (via auditEach) | n/a (write) | OP-WRITE | 561 |
| GET | `/api/assets/instances/tree` | ASSET_VIEW | — | no | UNBOUNDED whole list | READ | 175 |
| GET | `/api/assets/instances/{id}` | ASSET_VIEW | — | no | single record | READ | 247 |
| PUT | `/api/assets/instances/{id}` | any: ASSET_UPDATE, FILTER_EDIT, FILTER_HIERARCHY_EDIT | [UPDATE_ASSET, EDIT_FILTER, EDIT_HIERARCHY_NODE] | yes (via update) | n/a (write) | ADMIN-WRITE | 630 |
| DELETE | `/api/assets/instances/{id}` | any: ASSET_DELETE, FILTER_DELETE, FILTER_HIERARCHY_DELETE | [DELETE_ASSET, DELETE_FILTER, DELETE_HIERARCHY_NODE] | yes (via delete) | n/a (write) | ADMIN-WRITE | 782 |
| GET | `/api/assets/instances/{id}/children` | ASSET_VIEW | — | no | UNBOUNDED whole list | READ | 814 |
| PATCH | `/api/assets/instances/{id}/lifecycle-state` | FILTER_STATUS_UPDATE | UPDATE_FILTER_LIFECYCLE | yes (via changeLifecycleState) | n/a (write) | ADMIN-WRITE | 720 |
| POST | `/api/assets/instances/{id}/resubmit` | any: ASSET_CREATE, FILTER_CREATE, FILTER_BULK_UPLOAD | RESUBMIT_FILTER | yes (via update) | n/a (write) | OP-WRITE | 615 |
| PATCH | `/api/assets/instances/{id}/status` | ASSET_UPDATE | UPDATE_ASSET | yes (via changeStatus) | n/a (write) | ADMIN-WRITE | 679 |
| GET | `/api/assets/templates` | ASSET_VIEW | — | no | paginated (page,limit), no max limit | READ | 26 |
| GET | `/api/assets/templates/{id}` | ASSET_VIEW | — | no | single record | READ | 123 |

### audit (9)

Source: `apps/api/src/modules/audit/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/audit/` | AUDIT_READ | — | no | paginated (page,limit), no max limit | POLL | 38 |
| POST | `/api/audit/bulk-delete` | AUDIT_DELETE | BULK_DELETE_AUDIT_RECORDS | yes | n/a (write) | HEAVY | 879 |
| POST | `/api/audit/bulk-redact` | SUPER_ADMIN only | BULK_REDACT_AUDIT_RECORDS | yes | n/a (write) | HEAVY | 599 |
| POST | `/api/audit/report-export-log` | authenticated (any role) + in-handler role logic | — | yes | n/a (write) | HEAVY | 467 |
| GET | `/api/audit/verify-chain` | SUPER_ADMIN only | — | no | single record (result) — walks whole audit_trail | HEAVY | 952 |
| GET | `/api/audit/{id}` | AUDIT_READ | — | no | single record | READ | 381 |
| PUT | `/api/audit/{id}` | role: SUPER_ADMIN | UPDATE_AUDIT_RECORD | yes | n/a (write) | SA-ONLY | 702 |
| DELETE | `/api/audit/{id}` | AUDIT_DELETE | DELETE_AUDIT_RECORD | yes | n/a (write) | ADMIN-WRITE | 811 |
| POST | `/api/audit/{id}/redact` | SUPER_ADMIN only | REDACT_AUDIT_RECORD | yes | n/a (write) | SA-ONLY | 534 |

### auth (10)

Source: `apps/api/src/modules/auth/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| POST | `/api/auth/beacon-logout` | PUBLIC | — | yes (via beaconLogout) | n/a (write) | OP-WRITE | 187 |
| POST | `/api/auth/change-password` | authenticated (any role) | — | yes (via changePassword) | n/a (write) | OP-WRITE | 293 |
| POST | `/api/auth/forgot-password` | PUBLIC | — | yes (via forgotPassword) | n/a (write) | OP-WRITE | 360 |
| POST | `/api/auth/login` | PUBLIC | — | yes (via login) | n/a (write) | OP-WRITE | 19 |
| POST | `/api/auth/logout` | authenticated (any role) + in-handler role logic | — | yes (via logout) | n/a (write) | OP-WRITE | 115 |
| GET | `/api/auth/me` | authenticated (any role) | — | no | single record | READ | 216 |
| POST | `/api/auth/offline-grant` | authenticated (any role) + in-handler role logic | — | yes | n/a (write) | OP-WRITE | 415 |
| PUT | `/api/auth/profile` | authenticated (any role) | UPDATE_PROFILE | yes (via updateProfile) | n/a (write) | OP-WRITE | 248 |
| POST | `/api/auth/refresh` | authenticated (any role) | — | no | n/a (write) | POLL | 139 |
| POST | `/api/auth/verify` | authenticated (any role) | — | yes (via verify) | n/a (write) | OP-WRITE | 326 |

### backup (3)

Source: `apps/api/src/modules/backup/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/backup/export` | BACKUP_EXPORT | EXPORT_BACKUP | yes (export audited in backup.service.ts) | file | HEAVY | 17 |
| POST | `/api/backup/restore` | BACKUP_RESTORE | RESTORE_BACKUP | yes (via restoreDump) | n/a (write) | HEAVY | 101 |
| POST | `/api/backup/validate` | any: BACKUP_EXPORT, BACKUP_RESTORE | — | no (validation only) | n/a (write) | HEAVY | 228 |

### block-change-requests (5)

Source: `apps/api/src/modules/block-change-requests/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/block-change-requests/` | any: BLOCK_CHANGE_REQUEST, BLOCK_CHANGE_APPROVE | — | no | paginated (page,limit), no max limit | READ | 66 |
| POST | `/api/block-change-requests/` | BLOCK_CHANGE_REQUEST | REQUEST_BLOCK_CHANGE | yes (via create) | n/a (write) | OP-WRITE | 33 |
| GET | `/api/block-change-requests/pending-count` | BLOCK_CHANGE_APPROVE | — | no | single record | READ | 99 |
| POST | `/api/block-change-requests/{id}/approve` | BLOCK_CHANGE_APPROVE | APPROVE_BLOCK_CHANGE | yes (via process) | n/a (write) | OP-WRITE | 112 |
| POST | `/api/block-change-requests/{id}/reject` | BLOCK_CHANGE_APPROVE | REJECT_BLOCK_CHANGE | yes (via process) | n/a (write) | OP-WRITE | 131 |

### checklist-profiles (11)

Source: `apps/api/src/modules/checklist-profiles/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/checklist-profiles/` | any: FCP_READ, CHECKLIST_TOGGLE, VERSION_HISTORY_VIEW, FILTER_OPERATE | — | no | paginated (page,limit), no max limit | READ | 10 |
| POST | `/api/checklist-profiles/` | any: FCP_CREATE, CHECKLIST_CREATE | CREATE_CHECKLIST_PROFILE | yes (via create) | n/a (write) | ADMIN-WRITE | 31 |
| GET | `/api/checklist-profiles/{id}` | any: FCP_READ, CHECKLIST_TOGGLE, VERSION_HISTORY_VIEW | — | no | single record | READ | 26 |
| PUT | `/api/checklist-profiles/{id}` | any: FCP_UPDATE, CHECKLIST_EDIT | UPDATE_CHECKLIST_PROFILE | yes (via update) | n/a (write) | ADMIN-WRITE | 41 |
| DELETE | `/api/checklist-profiles/{id}` | any: FCP_DELETE, CHECKLIST_DELETE | DELETE_CHECKLIST_PROFILE | yes (via delete) | n/a (write) | ADMIN-WRITE | 50 |
| POST | `/api/checklist-profiles/{id}/questions` | any: FCP_CREATE, CHECKLIST_CREATE | CREATE_CHECKLIST_PROFILE | yes (via addQuestion) | n/a (write) | ADMIN-WRITE | 60 |
| PUT | `/api/checklist-profiles/{id}/questions/{questionId}` | any: FCP_UPDATE, CHECKLIST_EDIT | UPDATE_CHECKLIST_PROFILE | yes (via updateQuestion) | n/a (write) | ADMIN-WRITE | 70 |
| DELETE | `/api/checklist-profiles/{id}/questions/{questionId}` | any: FCP_DELETE, CHECKLIST_DELETE | DELETE_CHECKLIST_PROFILE | yes (via delete) | n/a (write) | ADMIN-WRITE | 79 |
| PUT | `/api/checklist-profiles/{id}/reorder` | any: FCP_UPDATE, CHECKLIST_EDIT | UPDATE_CHECKLIST_PROFILE | yes (via reorderQuestions) | n/a (write) | ADMIN-WRITE | 88 |
| GET | `/api/checklist-profiles/{id}/versions` | any: FCP_READ, CHECKLIST_TOGGLE, VERSION_HISTORY_VIEW | — | no | UNBOUNDED whole list | READ | 99 |
| GET | `/api/checklist-profiles/{id}/versions/{versionNumber}` | any: FCP_READ, CHECKLIST_TOGGLE, VERSION_HISTORY_VIEW | — | no | single record | READ | 105 |

### cleaning-profiles (8)

Source: `apps/api/src/modules/cleaning-profiles/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/filter-cleaning-profiles/` | any: FCP_READ, CP_TOGGLE, VERSION_HISTORY_VIEW, FILTER_OPERATE | — | no | paginated (page,limit), no max limit | READ | 14 |
| POST | `/api/filter-cleaning-profiles/` | any: FCP_CREATE, CP_PAGE_CREATE | CREATE_CLEANING_PROFILE | yes (via create) | n/a (write) | ADMIN-WRITE | 92 |
| GET | `/api/filter-cleaning-profiles/{id}` | any: FCP_READ, CP_TOGGLE, VERSION_HISTORY_VIEW, FILTER_OPERATE | — | no | single record | READ | 60 |
| PUT | `/api/filter-cleaning-profiles/{id}` | any: FCP_UPDATE, CP_PAGE_EDIT | UPDATE_CLEANING_PROFILE | yes (via update) | n/a (write) | ADMIN-WRITE | 153 |
| DELETE | `/api/filter-cleaning-profiles/{id}` | any: FCP_DELETE, CP_PAGE_DELETE | DELETE_CLEANING_PROFILE | yes (via archive) | n/a (write) | ADMIN-WRITE | 245 |
| PATCH | `/api/filter-cleaning-profiles/{id}/toggle-status` | any: FCP_UPDATE, CP_PAGE_EDIT | UPDATE_CLEANING_PROFILE | yes (via toggleStatus) | n/a (write) | ADMIN-WRITE | 220 |
| GET | `/api/filter-cleaning-profiles/{id}/versions` | any: FCP_READ, CP_TOGGLE, VERSION_HISTORY_VIEW | — | no | UNBOUNDED whole list (per-lineage version history) | READ | 287 |
| GET | `/api/filter-cleaning-profiles/{id}/versions/{versionNumber}` | any: FCP_READ, CP_TOGGLE, VERSION_HISTORY_VIEW | — | no | single record | READ | 315 |

### config (101)

Source: `apps/api/src/modules/config/dynamic-routes.ts`, `apps/api/src/modules/config/routes.ts`, `apps/api/src/modules/config/static-routes/access-matrix.routes.ts`, `apps/api/src/modules/config/static-routes/action-reauth.routes.ts`, `apps/api/src/modules/config/static-routes/ahu-completion-process.routes.ts`, `apps/api/src/modules/config/static-routes/audit-templates.routes.ts`, `apps/api/src/modules/config/static-routes/block-change-approval.routes.ts`, `apps/api/src/modules/config/static-routes/branding.routes.ts`, `apps/api/src/modules/config/static-routes/cleaning-profile-assignment.routes.ts`, `apps/api/src/modules/config/static-routes/dashboard-cards.routes.ts`, `apps/api/src/modules/config/static-routes/export-options.routes.ts`, `apps/api/src/modules/config/static-routes/field-ids.routes.ts`, `apps/api/src/modules/config/static-routes/offline-cache.routes.ts`, `apps/api/src/modules/config/static-routes/pm-schedule-filters.routes.ts`, `apps/api/src/modules/config/static-routes/replacement-schedule-filters.routes.ts`, `apps/api/src/modules/config/static-routes/report-labels.routes.ts`, `apps/api/src/modules/config/static-routes/report-page-titles.routes.ts`, `apps/api/src/modules/config/static-routes/report-signatories.routes.ts`, `apps/api/src/modules/config/static-routes/roles.routes.ts`, `apps/api/src/modules/config/static-routes/tablet-access.routes.ts`, `apps/api/src/modules/config/static-routes/user-id.routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/config/access-matrix` | CONFIG_READ | — | no | single record (config object) | READ | 9 |
| PUT | `/api/config/access-matrix` | CONFIG_UPDATE | UPDATE_ROLE_CONFIG (always) | yes | n/a (write) | ADMIN-WRITE | 17 |
| GET | `/api/config/access-matrix/my-modules` | authenticated (any role) + in-handler role logic | — | no | single record (config object) | READ | 63 |
| GET | `/api/config/action-reauth` | CONFIG_READ | — | no | single record (config object) | READ | 13 |
| PUT | `/api/config/action-reauth` | ROLE_MANAGE | UPDATE_REAUTH_CONFIG | yes (via updateActionReauth) | n/a (write) | ADMIN-WRITE | 26 |
| GET | `/api/config/action-reauth/check` | authenticated (any role) + in-handler role logic | — | no | single record | READ | 61 |
| GET | `/api/config/action-reauth/my-actions` | authenticated (any role) + in-handler role logic | — | no | single record (config object) | READ | 87 |
| GET | `/api/config/ahu-completion-process/current` | authenticated (any role) | — | no | single record | READ | 15 |
| GET | `/api/config/audit-templates` | CONFIG_READ | — | no | single record (config object) | READ | 9 |
| PUT | `/api/config/audit-templates` | CONFIG_UPDATE | UPDATE_AUDIT_TEMPLATES (always) | yes (via updateAuditTemplates) | n/a (write) | ADMIN-WRITE | 21 |
| GET | `/api/config/audit-templates/current` | authenticated (any role) | — | no | single record | READ | 53 |
| GET | `/api/config/backup-format` | CONFIG_READ | — | no | single record (config object) | READ | 73 |
| PUT | `/api/config/backup-format` | CONFIG_UPDATE | — | yes (via updateConfig) | n/a (write) | ADMIN-WRITE | 87 |
| GET | `/api/config/backup-format/current` | authenticated (any role) | — | no | single record | READ | 212 |
| GET | `/api/config/block-change-approval/current` | authenticated (any role) | — | no | single record | READ | 21 |
| GET | `/api/config/branding` | PUBLIC | — | no | single record (config object) | READ | 9 |
| PUT | `/api/config/branding` | CONFIG_UPDATE | UPDATE_BRANDING | yes (via updateConfig) | n/a (write) | ADMIN-WRITE | 22 |
| GET | `/api/config/cleaning-profile-assignment` | CONFIG_READ | — | no | single record (config object) | READ | 8 |
| PUT | `/api/config/cleaning-profile-assignment` | CONFIG_UPDATE | UPDATE_CONFIG_PAGE | yes | n/a (write) | ADMIN-WRITE | 38 |
| GET | `/api/config/cleaning-profile-assignment/current` | authenticated (any role) | — | no | single record | READ | 26 |
| PUT | `/api/config/dashboard-cards` | CONFIG_UPDATE | UPDATE_CONFIG_PAGE | yes | n/a (write) | ADMIN-WRITE | 27 |
| GET | `/api/config/dashboard-cards/current` | authenticated (any role) | — | no | single record | READ | 16 |
| GET | `/api/config/datetime` | SUPER_ADMIN only | — | no | single record (config object) | SA-ONLY | 73 |
| PUT | `/api/config/datetime` | SUPER_ADMIN only | UPDATE_DATETIME_CONFIG (+always) | yes (via updateConfig) | n/a (write) | SA-ONLY | 87 |
| GET | `/api/config/datetime/current` | PUBLIC | — | no | single record | READ | 183 |
| GET | `/api/config/dynamic/ahu-completion-process` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/ahu-completion-process` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/backup-format` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/backup-format` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/block-change-approval` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/block-change-approval` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/export-limit` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/export-limit` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/filter-approval` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/filter-approval` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/filter-cleaning-reasons` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/filter-cleaning-reasons` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/filter-field-options` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/filter-field-options` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/guest-cleaning-requests` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/guest-cleaning-requests` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/pm-schedule-approval` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/pm-schedule-approval` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/pm-schedule-settings` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/pm-schedule-settings` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/qnn-notifications` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/qnn-notifications` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/replacement-schedule-approval` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/replacement-schedule-approval` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/dynamic/stage-interlock` | role: SUPER_ADMIN (def.requiredRole) | — | no | single record (config object) | SA-ONLY | 38 |
| PUT | `/api/config/dynamic/stage-interlock` | role: SUPER_ADMIN (def.requiredRole) | UPDATE_CONFIG_PAGE (def.reauthAction) | yes | n/a (write) | SA-ONLY | 64 |
| GET | `/api/config/export-limit` | CONFIG_READ | — | no | single record (config object) | READ | 73 |
| PUT | `/api/config/export-limit` | CONFIG_UPDATE | — | yes (via updateConfig) | n/a (write) | ADMIN-WRITE | 87 |
| GET | `/api/config/export-limit/current` | authenticated (any role) | — | no | single record | READ | 197 |
| GET | `/api/config/export-options` | CONFIG_READ | — | no | single record (config object) | READ | 12 |
| PUT | `/api/config/export-options` | CONFIG_UPDATE | UPDATE_CONFIG_PAGE | yes | n/a (write) | ADMIN-WRITE | 20 |
| GET | `/api/config/export-options/current` | authenticated (any role) + in-handler role logic | — | no | single record | READ | 53 |
| GET | `/api/config/field-ids` | CONFIG_READ | — | no | UNBOUNDED whole list | READ | 11 |
| GET | `/api/config/field-ids/current` | authenticated (any role) | — | no | single record | READ | 52 |
| PUT | `/api/config/field-ids/{fieldId}` | FIELD_ID_UPDATE | UPDATE_FIELD_ID (always) | yes (via updateFieldId) | n/a (write) | ADMIN-WRITE | 75 |
| GET | `/api/config/login-security` | CONFIG_READ | — | no | single record (config object) | READ | 73 |
| PUT | `/api/config/login-security` | CONFIG_UPDATE | UPDATE_LOGIN_SECURITY (+always) | yes (via updateConfig) | n/a (write) | ADMIN-WRITE | 87 |
| GET | `/api/config/my-config` | authenticated (any role) | — | no | single record (config object) | READ | 176 |
| GET | `/api/config/offline-cache` | SUPER_ADMIN only | — | no | single record (config object) | SA-ONLY | 31 |
| PUT | `/api/config/offline-cache` | SUPER_ADMIN only | UPDATE_OFFLINE_CACHE_CONFIG | yes (via updateConfig) | n/a (write) | SA-ONLY | 47 |
| GET | `/api/config/offline-cache/current` | authenticated (any role) | — | no | single record | POLL | 79 |
| GET | `/api/config/pagination` | CONFIG_READ | — | no | single record (config object) | READ | 73 |
| PUT | `/api/config/pagination` | CONFIG_UPDATE | — | yes (via updateConfig) | n/a (write) | ADMIN-WRITE | 87 |
| GET | `/api/config/pagination/current` | authenticated (any role) | — | no | single record | READ | 172 |
| GET | `/api/config/password-policy` | CONFIG_READ | — | no | single record (config object) | READ | 73 |
| PUT | `/api/config/password-policy` | CONFIG_UPDATE | UPDATE_PASSWORD_POLICY (+always) | yes (via updateConfig) | n/a (write) | ADMIN-WRITE | 87 |
| GET | `/api/config/password-policy/current` | authenticated (any role) | — | no | single record | READ | 161 |
| GET | `/api/config/pm-schedule-filters` | CONFIG_READ | — | no | single record (config object) | READ | 12 |
| PUT | `/api/config/pm-schedule-filters` | CONFIG_UPDATE | UPDATE_CONFIG_PAGE | yes | n/a (write) | ADMIN-WRITE | 20 |
| GET | `/api/config/pm-schedule-filters/current` | authenticated (any role) + in-handler role logic | — | no | single record | READ | 48 |
| GET | `/api/config/registry/manifest` | authenticated (any role) + in-handler role logic | — | no | single record | READ | 13 |
| GET | `/api/config/replacement-schedule-filters` | CONFIG_READ | — | no | single record (config object) | READ | 12 |
| PUT | `/api/config/replacement-schedule-filters` | CONFIG_UPDATE | UPDATE_CONFIG_PAGE | yes | n/a (write) | ADMIN-WRITE | 20 |
| GET | `/api/config/replacement-schedule-filters/current` | authenticated (any role) + in-handler role logic | — | no | single record | READ | 48 |
| PUT | `/api/config/report-labels` | CONFIG_UPDATE | UPDATE_CONFIG_PAGE | yes | n/a (write) | ADMIN-WRITE | 32 |
| GET | `/api/config/report-labels/current` | authenticated (any role) | — | no | single record | READ | 21 |
| GET | `/api/config/report-page-titles` | CONFIG_READ | — | no | single record (config object) | READ | 38 |
| PUT | `/api/config/report-page-titles` | CONFIG_UPDATE | UPDATE_CONFIG_PAGE | yes | n/a (write) | ADMIN-WRITE | 47 |
| GET | `/api/config/report-page-titles/current` | authenticated (any role) | — | no | single record | READ | 25 |
| GET | `/api/config/report-signatories` | CONFIG_READ | — | no | single record (config object) | READ | 13 |
| PUT | `/api/config/report-signatories` | CONFIG_UPDATE | UPDATE_REPORT_SIGNATORIES (always) | yes | n/a (write) | ADMIN-WRITE | 22 |
| GET | `/api/config/report-signatories/resolved` | authenticated (any role) | — | no | single record (config object) | READ | 57 |
| GET | `/api/config/roles` | CONFIG_READ | — | no | UNBOUNDED whole list | READ | 7 |
| GET | `/api/config/roles/{role}` | CONFIG_READ | — | no | single record | READ | 32 |
| PUT | `/api/config/roles/{role}` | ROLE_MANAGE | UPDATE_ROLE_CONFIG | yes (via updateRoleConfig) | n/a (write) | ADMIN-WRITE | 60 |
| GET | `/api/config/session` | CONFIG_READ | — | no | single record (config object) | READ | 73 |
| PUT | `/api/config/session` | CONFIG_UPDATE | UPDATE_SESSION_CONFIG (+always) | yes (via updateConfig) | n/a (write) | ADMIN-WRITE | 87 |
| GET | `/api/config/tablet-access` | CONFIG_READ | — | no | single record (config object) | READ | 9 |
| PUT | `/api/config/tablet-access` | CONFIG_UPDATE | UPDATE_TABLET_ACCESS (always) | yes | n/a (write) | ADMIN-WRITE | 17 |
| GET | `/api/config/tablet-access/my-features` | authenticated (any role) + in-handler role logic | — | no | single record (config object) | READ | 65 |
| GET | `/api/config/user-id` | CONFIG_READ | — | no | single record (config object) | READ | 8 |
| PUT | `/api/config/user-id` | CONFIG_UPDATE | UPDATE_USERID_CONFIG | yes (via updateConfig) | n/a (write) | ADMIN-WRITE | 22 |
| GET | `/api/config/user-id/next` | USER_CREATE | — | no | single record | READ | 55 |
| POST | `/api/config/user-id/validate` | USER_CREATE | — | no (validation only) | n/a (write) | READ | 75 |
| GET | `/api/config/users/{userId}` | CONFIG_READ | — | no | single record | READ | 105 |
| PUT | `/api/config/users/{userId}` | ROLE_MANAGE | UPDATE_USER_CONFIG | yes (via updateUserConfig) | n/a (write) | ADMIN-WRITE | 133 |

### dashboards (13)

Source: `apps/api/src/modules/dashboards/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/dashboards/` | DASHBOARD_VIEW | — | no | paginated (page,limit), no max limit | READ | 48 |
| POST | `/api/dashboards/` | DASHBOARD_CREATE | — | yes | n/a (write) | ADMIN-WRITE | 127 |
| GET | `/api/dashboards/widget-types` | authenticated (any role) | — | no | single record (static list) | READ | 538 |
| DELETE | `/api/dashboards/{dashboardId}/assign/{assignmentId}` | DASHBOARD_ASSIGN | — | yes | n/a (write) | ADMIN-WRITE | 450 |
| GET | `/api/dashboards/{id}` | DASHBOARD_VIEW | — | no | single record | READ | 102 |
| PUT | `/api/dashboards/{id}` | DASHBOARD_MANAGE | — | yes | n/a (write) | ADMIN-WRITE | 172 |
| DELETE | `/api/dashboards/{id}` | DASHBOARD_MANAGE | — | yes | n/a (write) | ADMIN-WRITE | 216 |
| POST | `/api/dashboards/{id}/assign` | DASHBOARD_ASSIGN | — | yes | n/a (write) | ADMIN-WRITE | 411 |
| GET | `/api/dashboards/{id}/data/{widgetId}` | DASHBOARD_VIEW | — | no | single record | READ | 484 |
| PUT | `/api/dashboards/{id}/layout` | DASHBOARD_MANAGE | — | yes | n/a (write) | ADMIN-WRITE | 363 |
| POST | `/api/dashboards/{id}/widgets` | DASHBOARD_MANAGE | — | yes | n/a (write) | ADMIN-WRITE | 243 |
| PUT | `/api/dashboards/{id}/widgets/{widgetId}` | DASHBOARD_MANAGE | — | yes | n/a (write) | ADMIN-WRITE | 290 |
| DELETE | `/api/dashboards/{id}/widgets/{widgetId}` | DASHBOARD_MANAGE | — | yes | n/a (write) | ADMIN-WRITE | 334 |

### debug-traces (6)

Source: `apps/api/src/modules/debug-traces/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/debug/traces/` | READ_DEBUG_TRACE | — | no | paginated (page,pageSize), no max limit | POLL | 67 |
| PUT | `/api/debug/traces/entity/{id}/toggle` | MANAGE_DEBUG_TRACE | — | no (no-op) | n/a (write) | ADMIN-WRITE | 210 |
| GET | `/api/debug/traces/operation-trace` | READ_DEBUG_TRACE | — | no | single record (config) | READ | 171 |
| PUT | `/api/debug/traces/operation-trace` | MANAGE_DEBUG_TRACE | MANAGE_DEBUG_TRACES | yes | n/a (write) | ADMIN-WRITE | 179 |
| GET | `/api/debug/traces/stats` | READ_DEBUG_TRACE | — | no | single record | POLL | 146 |
| GET | `/api/debug/traces/{id}` | READ_DEBUG_TRACE | — | no | single record | READ | 219 |

### deployment-check (1)

Source: `apps/api/src/modules/deployment-check/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/deployment-check/` | role: SUPER_ADMIN | — | no | single record | SA-ONLY | 438 |

### equipment-groups (10)

Source: `apps/api/src/modules/equipment-groups/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/equipment-groups/` | any: ASSET_READ, EG_VIEW, VERSION_HISTORY_VIEW | — | no | UNBOUNDED whole list | READ | 31 |
| POST | `/api/equipment-groups/` | any: ASSET_CREATE, EG_CREATE | CREATE_EQUIPMENT_GROUP | yes (via create) | n/a (write) | ADMIN-WRITE | 160 |
| GET | `/api/equipment-groups/by-block/{blockId}` | any: ASSET_READ, EG_VIEW | — | no | UNBOUNDED whole list (scoped to one block; findMany, no take) | READ | 102 |
| POST | `/api/equipment-groups/fetch-readings` | FILTER_OPERATE | — | no | n/a (write) | ADMIN-WRITE | 122 |
| POST | `/api/equipment-groups/test-url` | any: ASSET_UPDATE, EG_EDIT | — | no | n/a (write) | ADMIN-WRITE | 146 |
| GET | `/api/equipment-groups/{id}` | any: ASSET_READ, EG_VIEW, VERSION_HISTORY_VIEW | — | no | single record | READ | 51 |
| PUT | `/api/equipment-groups/{id}` | any: ASSET_UPDATE, EG_EDIT | UPDATE_EQUIPMENT_GROUP | yes (via update) | n/a (write) | ADMIN-WRITE | 185 |
| DELETE | `/api/equipment-groups/{id}` | any: ASSET_DELETE, EG_DELETE | DELETE_EQUIPMENT_GROUP | yes (via delete) | n/a (write) | ADMIN-WRITE | 214 |
| GET | `/api/equipment-groups/{id}/versions` | any: ASSET_READ, EG_VIEW, VERSION_HISTORY_VIEW | — | no | UNBOUNDED whole list (per-group version history) | READ | 66 |
| GET | `/api/equipment-groups/{id}/versions/{versionNumber}` | any: ASSET_READ, EG_VIEW, VERSION_HISTORY_VIEW | — | no | single record | READ | 81 |

### filter-operations (26)

Source: `apps/api/src/modules/filter-operations/events-routes.ts`, `apps/api/src/modules/filter-operations/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| POST | `/api/filters/ahu-completion-status/batch` | ASSET_READ | — | no (read-only compute on POST) | n/a (write) | READ | 953 |
| POST | `/api/filters/ahu-set-availability` | ASSET_READ | — | no (read-only compute on POST) | n/a (write) | READ | 1007 |
| GET | `/api/filters/ahu/{ahuId}/completion-status` | ASSET_READ | — | no | single record | READ | 896 |
| GET | `/api/filters/batch-states` | ASSET_READ | — | no | UNBOUNDED whole list (getCurrentState for every active filter — batch-cache.ts) | READ | 275 |
| POST | `/api/filters/bulk-operate` | FILTER_OPERATE | computed `reauthActionsForItems(items)` — see modules/filter-operations/routes.ts:691 | yes (via startCycleImpl) | n/a (write) | HEAVY | 641 |
| GET | `/api/filters/cleaning-profiles/without-final-checklist` | ASSET_READ | — | no | UNBOUNDED whole list | READ | 859 |
| GET | `/api/filters/cleaning-record` | CYCLE_READ | — | no | paginated (page,limit), no max limit | READ | 80 |
| GET | `/api/filters/cycles` | CYCLE_READ | — | no | paginated (page,limit), no max limit | POLL | 46 |
| GET | `/api/filters/cycles/{id}` | CYCLE_READ | — | no | single record | READ | 147 |
| GET | `/api/filters/dashboard-stats` | CYCLE_READ | — | no | single record (aggregates — 9 count/groupBy) | POLL | 162 |
| GET | `/api/filters/events` | EVENT_READ | — | no | paginated (page,limit), no max limit | READ | 13 |
| GET | `/api/filters/field-options` | ASSET_READ | — | no | single record | READ | 207 |
| GET | `/api/filters/manual-status-changes` | CYCLE_READ | — | no | paginated (page,limit), no max limit | READ | 119 |
| GET | `/api/filters/reasons` | any: FILTER_OPERATE, ASSET_READ | — | no | single record (config-derived list) | READ | 174 |
| GET | `/api/filters/replacements` | any: ASSET_READ, REPLACEMENT_LIST_VIEW | — | no | UNBOUNDED whole list | POLL | 786 |
| GET | `/api/filters/retirements` | any: ASSET_READ, RETIREMENT_LIST_VIEW | — | no | UNBOUNDED whole list | POLL | 769 |
| POST | `/api/filters/{id}/advance` | FILTER_OPERATE | computed `withStageAction([ADVANCE_FILTER_STAGE], req.body)` — see modules/filter-operations/routes.ts:411 | yes (via executeAdvanceTx) | n/a (write) | OP-WRITE | 338 |
| POST | `/api/filters/{id}/advance-with-checklist` | FILTER_OPERATE | computed `withStageAction([ADVANCE_FILTER_STAGE, SUBMIT_CHECKLIST_WITH_SIGNATURE], req.body)` — see modules/filter-operations/routes.ts:508 | yes (via executeAdvanceTx) | n/a (write) | OP-WRITE | 428 |
| POST | `/api/filters/{id}/bypass` | FILTER_BYPASS | BYPASS_FILTER_STAGE | yes (via bypassImpl) | n/a (write) | OP-WRITE | 585 |
| GET | `/api/filters/{id}/current-state` | ASSET_READ | — | no | single record | POLL | 152 |
| POST | `/api/filters/{id}/replace` | FILTER_REPLACE | REPLACE_FILTER | yes (FILTER_REPLACED, filter-operations.service.ts replace) | n/a (write) | OP-WRITE | 729 |
| POST | `/api/filters/{id}/retire` | FILTER_RETIRE | RETIRE_FILTER | yes (via retireInTx) | n/a (write) | OP-WRITE | 698 |
| GET | `/api/filters/{id}/stage-options` | ASSET_READ | — | no | single record | READ | 94 |
| POST | `/api/filters/{id}/start-cycle` | FILTER_OPERATE | START_CLEANING_CYCLE | yes (via startCycleImpl) | n/a (write) | OP-WRITE | 294 |
| POST | `/api/filters/{id}/submit-checklist` | FILTER_OPERATE | SUBMIT_CHECKLIST_WITH_SIGNATURE | yes (via executeChecklistTx) | n/a (write) | OP-WRITE | 515 |
| POST | `/api/filters/{id}/terminate-cycle` | FILTER_BYPASS | TERMINATE_CLEANING_CYCLE | yes (via terminateCycleImpl) | n/a (write) | OP-WRITE | 801 |

### filter-profiles (8)

Source: `apps/api/src/modules/filter-profiles/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/filter-profiles/` | any: FP_READ, VERSION_HISTORY_VIEW | — | no | paginated (page,limit), no max limit | READ | 13 |
| POST | `/api/filter-profiles/` | FP_CREATE | CREATE_FILTER_PROFILE | yes (via create) | n/a (write) | ADMIN-WRITE | 86 |
| GET | `/api/filter-profiles/{id}` | any: FP_READ, VERSION_HISTORY_VIEW | — | no | single record | READ | 35 |
| PUT | `/api/filter-profiles/{id}` | FP_UPDATE | UPDATE_FILTER_PROFILE | yes (via update) | n/a (write) | ADMIN-WRITE | 114 |
| DELETE | `/api/filter-profiles/{id}` | FP_DELETE | DELETE_FILTER_PROFILE | yes (via delete) | n/a (write) | ADMIN-WRITE | 146 |
| POST | `/api/filter-profiles/{id}/assign` | FP_ASSIGN | ASSIGN_FILTER_PROFILE | yes (filter-profile.service.ts assign) | n/a (write) | ADMIN-WRITE | 166 |
| GET | `/api/filter-profiles/{id}/versions` | any: FP_READ, VERSION_HISTORY_VIEW | — | no | UNBOUNDED whole list (per-profile version history) | READ | 50 |
| GET | `/api/filter-profiles/{id}/versions/{versionNumber}` | any: FP_READ, VERSION_HISTORY_VIEW | — | no | single record | READ | 65 |

### guest (1)

Source: `apps/api/src/modules/guest/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| POST | `/api/guest/cleaning-request` | PUBLIC | — | yes | n/a (write) | OP-WRITE | 13 |

### help (6)

Source: `apps/api/src/modules/help/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/help/` | CONFIG_READ | — | no | UNBOUNDED whole list | READ | 10 |
| POST | `/api/help/` | role: SUPER_ADMIN | CREATE_HELP_ARTICLE | yes | n/a (write) | SA-ONLY | 132 |
| PUT | `/api/help/{id}` | role: SUPER_ADMIN | UPDATE_HELP_ARTICLE | yes | n/a (write) | SA-ONLY | 223 |
| DELETE | `/api/help/{id}` | role: SUPER_ADMIN | DELETE_HELP_ARTICLE | yes | n/a (write) | SA-ONLY | 372 |
| GET | `/api/help/{id}/versions` | role: SUPER_ADMIN, ADMIN | — | no | UNBOUNDED whole list | READ | 328 |
| GET | `/api/help/{key}` | CONFIG_READ | — | no | single record | READ | 79 |

### hierarchy (12)

Source: `apps/api/src/modules/hierarchy/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/hierarchy/ahus` | ASSET_VIEW | — | no | paginated (page,limit), no max limit | READ | 232 |
| GET | `/api/hierarchy/ahus/{id}` | ASSET_VIEW | — | no | single record | READ | 256 |
| GET | `/api/hierarchy/areas` | ASSET_VIEW | — | no | paginated (page,limit), no max limit | READ | 181 |
| GET | `/api/hierarchy/areas/{id}` | ASSET_VIEW | — | no | single record | READ | 205 |
| GET | `/api/hierarchy/blocks` | ASSET_VIEW | — | no | paginated (page,limit), no max limit | READ | 127 |
| GET | `/api/hierarchy/blocks/{id}` | ASSET_VIEW | — | no | single record | READ | 151 |
| GET | `/api/hierarchy/filters` | ASSET_VIEW | — | no | paginated (page,limit), no max limit | POLL | 281 |
| POST | `/api/hierarchy/filters` | any: ASSET_CREATE, FILTER_CREATE | [CREATE_ASSET, CREATE_FILTER] | yes (via assets/services/filter.service.ts create) | n/a (write) | ADMIN-WRITE | 320 |
| GET | `/api/hierarchy/filters/{id}` | ASSET_VIEW | — | no | single record | READ | 301 |
| PUT | `/api/hierarchy/filters/{id}` | any: ASSET_UPDATE, FILTER_EDIT | [UPDATE_ASSET, EDIT_FILTER] | yes (via assets/services/filter.service.ts update) | n/a (write) | ADMIN-WRITE | 361 |
| DELETE | `/api/hierarchy/filters/{id}` | any: ASSET_DELETE, FILTER_DELETE | [DELETE_ASSET, DELETE_FILTER] | yes (via softDelete) | n/a (write) | ADMIN-WRITE | 395 |
| GET | `/api/hierarchy/tree` | ASSET_VIEW | — | no | UNBOUNDED whole list | POLL | 416 |

### ldap (4)

Source: `apps/api/src/modules/ldap/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/ldap/config` | CONFIG_READ | — | no | single record | READ | 23 |
| PUT | `/api/ldap/config` | CONFIG_UPDATE | UPDATE_LDAP_CONFIG | yes | n/a (write) | ADMIN-WRITE | 32 |
| GET | `/api/ldap/status` | CONFIG_READ | — | no | single record | READ | 82 |
| POST | `/api/ldap/test-connection` | CONFIG_UPDATE | — | no | n/a (write) | ADMIN-WRITE | 68 |

### notification-delivery (18)

Source: `apps/api/src/modules/notification-delivery/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/notification-settings/email` | CONFIG_READ | — | no | single record | READ | 54 |
| PUT | `/api/notification-settings/email` | CONFIG_UPDATE | UPDATE_EMAIL_CONFIG | yes | n/a (write) | ADMIN-WRITE | 79 |
| GET | `/api/notification-settings/email/oauth2/authorize` | CONFIG_UPDATE | — | no | single record | READ | 196 |
| GET | `/api/notification-settings/email/oauth2/code` | PUBLIC | — | no | single record (OAuth callback) | READ | 259 |
| GET | `/api/notification-settings/email/oauth2/redirect-uri` | CONFIG_READ | — | no | single record | READ | 180 |
| GET | `/api/notification-settings/email/oauth2/status` | CONFIG_READ | — | no | single record | READ | 387 |
| POST | `/api/notification-settings/email/test` | CONFIG_UPDATE | — | no | n/a (write) | ADMIN-WRITE | 152 |
| GET | `/api/notification-settings/logs` | CONFIG_READ | — | no | paginated (page,limit), no max limit | READ | 539 |
| GET | `/api/notification-settings/logs/stats` | CONFIG_READ | — | no | single record | READ | 588 |
| DELETE | `/api/notification-settings/logs/{id}` | CONFIG_UPDATE | DELETE_NOTIFICATION_LOG | yes | n/a (write) | ADMIN-WRITE | 606 |
| POST | `/api/notification-settings/send` | CONFIG_UPDATE | — | no | n/a (write) | ADMIN-WRITE | 513 |
| GET | `/api/notification-settings/sms` | CONFIG_READ | — | no | single record | READ | 406 |
| PUT | `/api/notification-settings/sms` | CONFIG_UPDATE | UPDATE_SMS_CONFIG | yes | n/a (write) | ADMIN-WRITE | 430 |
| POST | `/api/notification-settings/sms/test` | CONFIG_UPDATE | — | no | n/a (write) | ADMIN-WRITE | 496 |
| GET | `/api/notification-settings/templates` | CONFIG_READ | — | no | UNBOUNDED whole list | READ | 645 |
| POST | `/api/notification-settings/templates` | CONFIG_UPDATE | — | yes | n/a (write) | ADMIN-WRITE | 650 |
| PUT | `/api/notification-settings/templates/{id}` | CONFIG_UPDATE | — | yes | n/a (write) | ADMIN-WRITE | 678 |
| DELETE | `/api/notification-settings/templates/{id}` | CONFIG_UPDATE | — | yes | n/a (write) | ADMIN-WRITE | 713 |

> **Note added 2026-10-22 (SEC-03):** after this inventory was taken, `POST /api/notification-settings/send` was removed, and `email/test` / `sms/test` now write a `NOTIFICATION_TEST_SENT` audit row. The rows above are kept as dated evidence.

### notification-rules (8)

Source: `apps/api/src/modules/notification-rules/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/notification-rules/` | CONFIG_READ | — | no | UNBOUNDED whole list | READ | 40 |
| POST | `/api/notification-rules/` | CONFIG_UPDATE | MANAGE_NOTIFICATION_RULES | yes | n/a (write) | ADMIN-WRITE | 100 |
| GET | `/api/notification-rules/event-types` | CONFIG_READ | — | no | single record (static list) | READ | 29 |
| GET | `/api/notification-rules/{id}` | CONFIG_READ | — | no | single record | READ | 83 |
| PUT | `/api/notification-rules/{id}` | CONFIG_UPDATE | MANAGE_NOTIFICATION_RULES | yes | n/a (write) | ADMIN-WRITE | 180 |
| DELETE | `/api/notification-rules/{id}` | CONFIG_UPDATE | MANAGE_NOTIFICATION_RULES | yes | n/a (write) | ADMIN-WRITE | 284 |
| POST | `/api/notification-rules/{id}/test` | CONFIG_UPDATE | — | no | n/a (write) | ADMIN-WRITE | 351 |
| PUT | `/api/notification-rules/{id}/toggle` | CONFIG_UPDATE | MANAGE_NOTIFICATION_RULES | yes | n/a (write) | ADMIN-WRITE | 310 |

### notifications (9)

Source: `apps/api/src/modules/notifications/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/notifications/` | authenticated (any role) + in-handler role logic | — | no | paginated (page,limit), no max limit | POLL | 10 |
| POST | `/api/notifications/bulk-delete` | NOTIFICATION_DELETE | BULK_DELETE_NOTIFICATIONS | yes (via bulkDelete) | n/a (write) | HEAVY | 161 |
| PUT | `/api/notifications/bulk-read` | authenticated (any role) + in-handler role logic | — | no | n/a (write) | ADMIN-WRITE | 105 |
| PUT | `/api/notifications/bulk-unread` | authenticated (any role) + in-handler role logic | — | no | n/a (write) | ADMIN-WRITE | 133 |
| PUT | `/api/notifications/mark-all-read` | authenticated (any role) + in-handler role logic | — | no | n/a (write) | ADMIN-WRITE | 86 |
| GET | `/api/notifications/unread-count` | authenticated (any role) + in-handler role logic | — | no | single record | POLL | 67 |
| DELETE | `/api/notifications/{id}` | NOTIFICATION_DELETE | DELETE_NOTIFICATION | yes (via delete) | n/a (write) | ADMIN-WRITE | 251 |
| PUT | `/api/notifications/{id}/read` | authenticated (any role) + in-handler role logic | — | no | n/a (write) | ADMIN-WRITE | 195 |
| PUT | `/api/notifications/{id}/unread` | authenticated (any role) + in-handler role logic | — | no | n/a (write) | ADMIN-WRITE | 223 |

### pm-schedules (28)

Source: `apps/api/src/modules/pm-schedules/execution-routes.ts`, `apps/api/src/modules/pm-schedules/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| POST | `/api/pm-executions/` | PM_EXECUTE | START_PM_TASK | yes (via createExecution) | n/a (write) | OP-WRITE | 22 |
| POST | `/api/pm-schedules/` | PM_CREATE | CREATE_PM_SCHEDULE | yes (via create) | n/a (write) | OP-WRITE | 660 |
| GET | `/api/pm-schedules/ahu-configs` | PM_READ | — | no | UNBOUNDED whole list (one row per AHU) | READ | 290 |
| PUT | `/api/pm-schedules/ahu-configs/{ahuId}` | PM_UPDATE | UPDATE_CONFIG_PAGE | yes (via updateAhuFilterSetMode) | n/a (write) | OP-WRITE | 302 |
| GET | `/api/pm-schedules/deviations` | PM_READ | — | no | paginated (page,limit), no max limit | POLL | 559 |
| POST | `/api/pm-schedules/deviations/sweep` | PM_UPDATE | — | yes (via sweepOverdueDeviations) | n/a (write) | OP-WRITE | 547 |
| POST | `/api/pm-schedules/deviations/{id}/acknowledge` | PM_EXECUTE | ACKNOWLEDGE_PM_OVERDUE (always) | yes (via acknowledgeDeviation) | n/a (write) | OP-WRITE | 579 |
| GET | `/api/pm-schedules/due` | PM_READ | — | no | UNBOUNDED whole list (window/date-range scoped; from/to optional; grouped by AHU with child filters) | POLL | 625 |
| GET | `/api/pm-schedules/entries` | PM_READ | — | no | paginated (page,limit), no max limit | POLL | 330 |
| POST | `/api/pm-schedules/entries/approve` | PM_APPROVE | APPROVE_PM_SCHEDULE | yes (via approveEntries) | n/a (write) | OP-WRITE | 419 |
| GET | `/api/pm-schedules/entries/export.xlsx` | PM_READ | EXPORT_PM_SCHEDULE | no | file | HEAVY | 373 |
| GET | `/api/pm-schedules/entries/pending-counts` | PM_READ | — | no | single record | READ | 360 |
| POST | `/api/pm-schedules/entries/reject` | PM_APPROVE | REJECT_PM_SCHEDULE | yes (via rejectEntries) | n/a (write) | OP-WRITE | 442 |
| POST | `/api/pm-schedules/entries/review` | PM_REVIEW | REVIEW_PM_SCHEDULE | yes (via reviewEntries) | n/a (write) | OP-WRITE | 395 |
| PUT | `/api/pm-schedules/entries/{id}/edit` | any: PM_UPDATE, PM_EDIT_ENTRY | EDIT_PM_SCHEDULE | yes (via editApprovedEntry) | n/a (write) | OP-WRITE | 493 |
| POST | `/api/pm-schedules/entries/{id}/resubmit` | any: PM_CREATE, PM_RESUBMIT | RESUBMIT_PM_ENTRY | yes (via resubmitEntry) | n/a (write) | OP-WRITE | 465 |
| PUT | `/api/pm-schedules/entries/{id}/review-edit` | PM_REVIEW | REVIEW_PM_SCHEDULE | yes (via modifyReviewEntry) | n/a (write) | OP-WRITE | 520 |
| GET | `/api/pm-schedules/pending-tasks-map` | PM_READ | — | no | UNBOUNDED whole list (map over every AHU) | READ | 611 |
| GET | `/api/pm-schedules/qnn` | authenticated (any role) + in-handler role logic | — | no | paginated (page,limit), no max limit | READ | 100 |
| GET | `/api/pm-schedules/qnn/visible` | authenticated (any role) + in-handler role logic | — | no | single record | READ | 96 |
| GET | `/api/pm-schedules/settings` | PM_READ | — | no | single record | READ | 129 |
| GET | `/api/pm-schedules/template.csv` | any: PM_READ, PM_DOWNLOAD_TEMPLATE | — | no | file | HEAVY | 187 |
| POST | `/api/pm-schedules/upload` | any: PM_CREATE, PM_UPLOAD | UPLOAD_PM_SCHEDULES | yes (via importSchedules) | n/a (write) | HEAVY | 202 |
| GET | `/api/pm-schedules/workflow-config` | PM_READ | — | no | single record | READ | 163 |
| GET | `/api/pm-schedules/{entityId}` | PM_READ | — | no | single record | READ | 644 |
| GET | `/api/pm-schedules/{entityId}/history` | PM_READ | — | no | UNBOUNDED whole list | READ | 752 |
| PUT | `/api/pm-schedules/{id}` | PM_UPDATE | UPDATE_PM_SCHEDULE | yes (via update) | n/a (write) | OP-WRITE | 696 |
| DELETE | `/api/pm-schedules/{id}` | SUPER_ADMIN only | DELETE_PM_SCHEDULE | yes (via remove) | n/a (write) | SA-ONLY | 732 |

### replacement-schedule (14)

Source: `apps/api/src/modules/replacement-schedule/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/replacement-schedules/` | REPLACEMENT_SCHEDULE_VIEW | — | no | UNBOUNDED whole list | POLL | 85 |
| POST | `/api/replacement-schedules/` | REPLACEMENT_SCHEDULE_UPLOAD | UPLOAD_REPLACEMENT_SCHEDULE | yes (via processUpload) | n/a (write) | HEAVY | 72 |
| GET | `/api/replacement-schedules/blocked-filters` | any: REPLACEMENT_SCHEDULE_VIEW, FILTER_OPERATE | — | no | UNBOUNDED whole list (id set) | POLL | 184 |
| GET | `/api/replacement-schedules/due` | any: REPLACEMENT_SCHEDULE_VIEW, FILTER_OPERATE | — | no | UNBOUNDED whole list | READ | 162 |
| POST | `/api/replacement-schedules/entries/approve` | REPLACEMENT_SCHEDULE_APPROVE | APPROVE_REPLACEMENT_SCHEDULE | yes (via approveEntries) | n/a (write) | OP-WRITE | 119 |
| POST | `/api/replacement-schedules/entries/reject` | REPLACEMENT_SCHEDULE_APPROVE | REJECT_REPLACEMENT_SCHEDULE | yes (via rejectEntries) | n/a (write) | OP-WRITE | 128 |
| POST | `/api/replacement-schedules/entries/review` | REPLACEMENT_SCHEDULE_REVIEW | REVIEW_REPLACEMENT_SCHEDULE | yes (via reviewEntries) | n/a (write) | OP-WRITE | 110 |
| POST | `/api/replacement-schedules/entries/{id}/execute` | FILTER_REPLACE | REPLACE_FILTER | yes (via filterOps.replace -> FILTER_REPLACED) | n/a (write) | OP-WRITE | 204 |
| POST | `/api/replacement-schedules/entries/{id}/resubmit` | REPLACEMENT_SCHEDULE_UPLOAD | REVIEW_REPLACEMENT_SCHEDULE | yes (via resubmitEntry) | n/a (write) | OP-WRITE | 137 |
| PUT | `/api/replacement-schedules/entries/{id}/review-edit` | REPLACEMENT_SCHEDULE_REVIEW | REVIEW_REPLACEMENT_SCHEDULE | yes (via modifyReviewEntry) | n/a (write) | OP-WRITE | 146 |
| GET | `/api/replacement-schedules/export.xlsx` | REPLACEMENT_SCHEDULE_VIEW | EXPORT_REPLACEMENT_SCHEDULE | no | file | HEAVY | 94 |
| GET | `/api/replacement-schedules/tasks` | any: REPLACEMENT_SCHEDULE_VIEW, FILTER_OPERATE | — | no | UNBOUNDED whole list | POLL | 173 |
| GET | `/api/replacement-schedules/template.xlsx` | any: REPLACEMENT_SCHEDULE_VIEW, REPLACEMENT_SCHEDULE_UPLOAD | — | no | file | HEAVY | 33 |
| POST | `/api/replacement-schedules/validate` | REPLACEMENT_SCHEDULE_UPLOAD | — | yes (via processUpload) | n/a (write) | HEAVY | 61 |

### report-reviews (6)

Source: `apps/api/src/modules/report-reviews/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/report-reviews/` | any: REPORT_REVIEW_SUBMIT, REPORT_REVIEW, REPORT_APPROVE | — | no | UNBOUNDED whole list (svc.list findMany, no take) | READ | 45 |
| POST | `/api/report-reviews/` | REPORT_REVIEW_SUBMIT | SUBMIT_REPORT_REVIEW | yes (via submit) | n/a (write) | OP-WRITE | 9 |
| GET | `/api/report-reviews/queue` | any: REPORT_REVIEW_SUBMIT, REPORT_REVIEW, REPORT_APPROVE | — | no | UNBOUNDED whole list (svc.queue findMany, no take) | POLL | 36 |
| GET | `/api/report-reviews/{id}` | any: REPORT_REVIEW_SUBMIT, REPORT_REVIEW, REPORT_APPROVE | — | no | single record | READ | 58 |
| POST | `/api/report-reviews/{id}/approve` | REPORT_APPROVE | APPROVE_REPORT (always) | yes (service.ts this.audit -> auditLog) | n/a (write) | OP-WRITE | 92 |
| POST | `/api/report-reviews/{id}/review` | REPORT_REVIEW | REVIEW_REPORT (always) | yes (service.ts this.audit -> auditLog) | n/a (write) | OP-WRITE | 67 |

### roles (9)

Source: `apps/api/src/modules/roles/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/roles/` | ROLE_MANAGE | — | no | UNBOUNDED whole list | READ | 28 |
| POST | `/api/roles/` | ROLE_MANAGE | CREATE_ROLE | yes (via create) | n/a (write) | ADMIN-WRITE | 193 |
| GET | `/api/roles/access-matrix` | authenticated (any role) | — | no | single record (matrix, bounded by role count) | POLL | 89 |
| GET | `/api/roles/active` | PUBLIC | — | no | UNBOUNDED whole list | READ | 60 |
| GET | `/api/roles/permissions/all` | ROLE_MANAGE | — | no | single record (static catalog) | READ | 121 |
| GET | `/api/roles/{name}` | ROLE_MANAGE | — | no | single record | READ | 151 |
| PUT | `/api/roles/{name}` | ROLE_MANAGE | UPDATE_ROLE | yes (via update) | n/a (write) | ADMIN-WRITE | 243 |
| DELETE | `/api/roles/{name}` | ROLE_MANAGE | DELETE_ROLE | yes (via delete) | n/a (write) | ADMIN-WRITE | 300 |
| GET | `/api/roles/{name}/creatable` | USER_CREATE | — | no | UNBOUNDED whole list | READ | 362 |

### stage-approvals (6)

Source: `apps/api/src/modules/stage-approvals/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/stage-approvals/` | any: STAGE_APPROVAL_VIEW, FILTER_OPERATE | — | no | UNBOUNDED whole list (svc.list findMany, no take) | READ | 22 |
| POST | `/api/stage-approvals/bulk-decide` | STAGE_APPROVAL_DECIDE | computed `b.action === approve ? APPROVE_CLEANING_STAGE : REJECT_CLEANING_STAGE` — see modules/stage-approvals/routes.ts:106 (always) | yes (via reject) | n/a (write) | HEAVY | 84 |
| GET | `/api/stage-approvals/queue` | STAGE_APPROVAL_VIEW | — | yes — WRITES ON GET (supersedeOrphan, stage-approvals/service.ts:177-262) | UNBOUNDED whole list (svc.queue findMany, no take) | POLL | 9 |
| GET | `/api/stage-approvals/{id}` | STAGE_APPROVAL_VIEW | — | no | single record | READ | 34 |
| POST | `/api/stage-approvals/{id}/approve` | STAGE_APPROVAL_DECIDE | APPROVE_CLEANING_STAGE (always) | yes (via approve) | n/a (write) | OP-WRITE | 43 |
| POST | `/api/stage-approvals/{id}/reject` | STAGE_APPROVAL_DECIDE | REJECT_CLEANING_STAGE (always) | yes (via reject) | n/a (write) | OP-WRITE | 62 |

### super-admin (41)

Source: `apps/api/src/modules/super-admin/record-edit-routes.ts`, `apps/api/src/modules/super-admin/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/super-admin/api-lock` | role: SUPER_ADMIN | — | no | single record | SA-ONLY | 85 |
| PUT | `/api/super-admin/api-lock` | role: SUPER_ADMIN | TOGGLE_SUPER_ADMIN_API_ACCESS (always) | yes | n/a (write) | SA-ONLY | 96 |
| GET | `/api/super-admin/data/admin-requests` | role: SUPER_ADMIN | — | no | paginated (page,limit; default 25, no max — paginatedList) | SA-ONLY | 1307 |
| POST | `/api/super-admin/data/admin-requests` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1332 |
| PUT | `/api/super-admin/data/admin-requests/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1311 |
| DELETE | `/api/super-admin/data/admin-requests/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1352 |
| GET | `/api/super-admin/data/audit-trail` | role: SUPER_ADMIN | — | no | paginated (page,limit; default 25, no max — paginatedList) | SA-ONLY | 1152 |
| GET | `/api/super-admin/data/block-change-requests` | role: SUPER_ADMIN | — | no | paginated (page,limit; default 25, no max — paginatedList) | SA-ONLY | 1360 |
| POST | `/api/super-admin/data/block-change-requests` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1394 |
| PUT | `/api/super-admin/data/block-change-requests/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1364 |
| DELETE | `/api/super-admin/data/block-change-requests/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1418 |
| GET | `/api/super-admin/data/cleaning-cycles` | role: SUPER_ADMIN | — | no | paginated (page,limit), no max limit | SA-ONLY | 913 |
| POST | `/api/super-admin/data/cleaning-cycles` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 972 |
| PUT | `/api/super-admin/data/cleaning-cycles/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 927 |
| DELETE | `/api/super-admin/data/cleaning-cycles/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1020 |
| PUT | `/api/super-admin/data/deviations/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1233 |
| GET | `/api/super-admin/data/filter-events` | role: SUPER_ADMIN | — | no | paginated (page,limit), no max limit | SA-ONLY | 1055 |
| POST | `/api/super-admin/data/filter-events` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1105 |
| PUT | `/api/super-admin/data/filter-events/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1069 |
| DELETE | `/api/super-admin/data/filter-events/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1135 |
| GET | `/api/super-admin/data/notifications` | role: SUPER_ADMIN | — | no | paginated (page,limit), no max limit | SA-ONLY | 1157 |
| POST | `/api/super-admin/data/notifications` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1197 |
| PUT | `/api/super-admin/data/notifications/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1171 |
| DELETE | `/api/super-admin/data/notifications/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1221 |
| GET | `/api/super-admin/data/pm-entries` | role: SUPER_ADMIN | — | no | paginated (page,limit), no max limit | SA-ONLY | 1437 |
| POST | `/api/super-admin/data/pm-entries` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1471 |
| PUT | `/api/super-admin/data/pm-entries/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1451 |
| DELETE | `/api/super-admin/data/pm-entries/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1500 |
| GET | `/api/super-admin/data/pm-schedules` | role: SUPER_ADMIN | — | no | UNBOUNDED whole list | SA-ONLY | 1429 |
| PUT | `/api/super-admin/data/quality-notifications/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 1272 |
| PUT | `/api/super-admin/filter-data/filters/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via changeLifecycleState) | n/a (write) | SA-ONLY | 163 |
| POST | `/api/super-admin/filter-data/replacements` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes | n/a (write) | SA-ONLY | 659 |
| PUT | `/api/super-admin/filter-data/replacements/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes | n/a (write) | SA-ONLY | 577 |
| DELETE | `/api/super-admin/filter-data/replacements/{id}` | role: SUPER_ADMIN; role: SUPER_ADMIN; role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT, SUPER_ADMIN_DATA_EDIT | yes | n/a (write) | SA-ONLY | 741 |
| POST | `/api/super-admin/filter-data/retirements` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes | n/a (write) | SA-ONLY | 273 |
| PUT | `/api/super-admin/filter-data/retirements/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes | n/a (write) | SA-ONLY | 156 |
| DELETE | `/api/super-admin/filter-data/retirements/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 363 |
| POST | `/api/super-admin/filter-data/retirements/{id}/unretire` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 441 |
| PUT | `/api/super-admin/filter-data/rfid-events/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes | n/a (write) | SA-ONLY | 32 |
| PUT | `/api/super-admin/filter-data/stage-approvals/{id}` | role: SUPER_ADMIN | SUPER_ADMIN_DATA_EDIT | yes (via auditManualChange) | n/a (write) | SA-ONLY | 319 |
| GET | `/api/super-admin/stats` | role: SUPER_ADMIN | — | no | single record | SA-ONLY | 63 |

### sync (1)

Source: `apps/api/src/modules/sync/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/sync/since` | any: ASSET_VIEW, FILTER_OPERATE | — | no | bounded (sync.service applies take on each findMany) | POLL | 30 |

### system-health (1)

Source: `apps/api/src/modules/system-health/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/system-health/` | role: SUPER_ADMIN, ADMIN | — | no | single record | POLL | 122 |

### uploads (1)

Source: `apps/api/src/modules/uploads/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| POST | `/api/uploads/photo` | authenticated (any role) | — | no (writes file) | n/a (write) | HEAVY | 33 |

### user-groups (7)

Source: `apps/api/src/modules/user-groups/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/user-groups/` | CONFIG_READ | — | no | UNBOUNDED whole list | READ | 15 |
| POST | `/api/user-groups/` | CONFIG_UPDATE | MANAGE_USER_GROUPS | yes | n/a (write) | ADMIN-WRITE | 31 |
| PUT | `/api/user-groups/{id}` | CONFIG_UPDATE | MANAGE_USER_GROUPS | yes | n/a (write) | ADMIN-WRITE | 58 |
| DELETE | `/api/user-groups/{id}` | CONFIG_UPDATE | MANAGE_USER_GROUPS | yes | n/a (write) | ADMIN-WRITE | 101 |
| GET | `/api/user-groups/{id}/members` | CONFIG_READ | — | no | UNBOUNDED whole list | READ | 139 |
| POST | `/api/user-groups/{id}/members` | CONFIG_UPDATE | MANAGE_USER_GROUPS | yes | n/a (write) | ADMIN-WRITE | 172 |
| DELETE | `/api/user-groups/{id}/members/{userId}` | CONFIG_UPDATE | MANAGE_USER_GROUPS | yes | n/a (write) | ADMIN-WRITE | 211 |

### users (15)

Source: `apps/api/src/modules/users/routes.ts`

| Method | Path | Auth gate | Re-auth | Audited write? | Result size | Load-test class | Line |
|---|---|---|---|---|---|---|---|
| GET | `/api/users/` | USER_READ | — | no | paginated (page,limit), no max limit | READ | 191 |
| POST | `/api/users/` | USER_CREATE | CREATE_USER | yes (via create) | n/a (write) | ADMIN-WRITE | 11 |
| POST | `/api/users/bulk-delete` | SUPER_ADMIN only | BULK_DELETE_USERS | yes (via bulkDelete) | n/a (write) | HEAVY | 81 |
| POST | `/api/users/password-expiry-sweep` | CONFIG_UPDATE | — | no (creates notifications only — auth/password-expiry-sweep.ts) | n/a (write) | ADMIN-WRITE | 401 |
| GET | `/api/users/reset-requests` | USER_RESET_PASSWORD | — | no | UNBOUNDED whole list | READ | 119 |
| GET | `/api/users/reset-requests/pending` | USER_RESET_PASSWORD | — | no | single record | READ | 149 |
| POST | `/api/users/reset-requests/{id}/process` | USER_RESET_PASSWORD | PROCESS_RESET_REQUEST | yes (via processResetRequest) | n/a (write) | ADMIN-WRITE | 160 |
| GET | `/api/users/stats` | USER_READ | — | no | single record | POLL | 60 |
| GET | `/api/users/{id}` | USER_READ | — | no | single record | READ | 234 |
| PUT | `/api/users/{id}` | USER_UPDATE | UPDATE_USER | yes (via update) | n/a (write) | ADMIN-WRITE | 265 |
| DELETE | `/api/users/{id}` | SUPER_ADMIN only | DELETE_USER | yes (via delete) | n/a (write) | SA-ONLY | 308 |
| POST | `/api/users/{id}/disable` | USER_ENABLE_DISABLE | DISABLE_USER | yes (via disable) | n/a (write) | ADMIN-WRITE | 343 |
| POST | `/api/users/{id}/enable` | USER_ENABLE_DISABLE | ENABLE_USER | yes (via enable) | n/a (write) | ADMIN-WRITE | 327 |
| POST | `/api/users/{id}/reset-password` | USER_RESET_PASSWORD | RESET_PASSWORD | yes (via resetPassword) | n/a (write) | ADMIN-WRITE | 378 |
| POST | `/api/users/{id}/unlock` | USER_UNLOCK | UNLOCK_USER | yes (via unlock) | n/a (write) | ADMIN-WRITE | 359 |

## Method

Derived 2026-10-17 on branch `RFID` (HEAD `755f0ae`), read-only. No load was run and the database was not touched.

1. **Operations**: taken from `tests/performance/results/openapi.json` (429 operations, 328 paths). The 13 `/api/config/dynamic/*` GET/PUT pairs come from one templated loop in `modules/config/dynamic-routes.ts:38/64`, generated per config def with `hasCustomPage: false`; every such def has `requiredRole: 'SUPER_ADMIN'` and `reauthAction: 'UPDATE_CONFIG_PAGE'`. The seven `/api/config/<key>` + `PUT` pairs come from the `configEndpoint` factory, `modules/config/routes.ts:70-145`.
2. **Source match**: every `app.get|post|put|patch|delete(...)` call in the route files was parsed. Its prefix comes from the `app.register(..., { prefix })` list in `apps/api/src/app.ts:629-668`. The `assets`, `config/static-routes/*` and `super-admin/record-edit-routes.ts` sub-plugins inherit their parent prefix. All 429 operations matched a source route. The reverse check (source routes missing from the spec) found **0**.
3. **Auth gate**: `app.requirePermission / requireAnyPermission / requireRole / requireSuperAdmin` calls inside each route's `preHandler`. Shared preHandler constants (`dataPreHandler`, `dataMutationPreHandler`, `guarded` in super-admin) were expanded. `requireDataEditReauth` is read as `enforceReauth('SUPER_ADMIN_DATA_EDIT')` (`super-admin/manual-change.ts:12`). Public = `plugins/auth.ts` lists only.
4. **Re-auth**: first argument of `enforceReauth(...)` / `enforceReauthAlways(...)` in the handler. When the key is computed (stage-derived on `/advance`, `/advance-with-checklist`, `/bulk-operate`; per-decision on `/stage-approvals/bulk-decide`), the expression and its line are shown. **Every re-auth-gated request that actually prompts also writes a hash-chained `REAUTH_SUCCESS` / `REAUTH_FAILED` audit row**, separate from the business audit row. Count that as an extra audit write per signed request under load. It is not counted in the "Audited write?" column.
5. **Audited write?**: `yes` = `auditLog(` (or `auditTrail.create(`) appears in the handler. `yes (via fn)` = found by tracing the functions the handler calls, up to 3 levels deep, preferring definitions in the same module. Names defined in many modules (`create`, `update`, `delete`, `process`) are resolved by same-module match only, so treat those as **heuristic**. About 10 of them and every `?` were checked by hand and corrected (e.g. `password-expiry-sweep` and the notification read toggles are `no`; `hierarchy/filters` create/update and `replacement-schedules/entries/{id}/execute` are `yes` through cross-module calls). For a GET where nothing was found the cell is `no`. That is an inference, not a proof, and `GET /api/stage-approvals/queue` is one GET that does write.
6. **Result size**: `paginated` when the OpenAPI query schema has `page`/`limit`/`pageSize` (and `no max limit` when that param has no `maximum`, which is true of all of them). `file` when the handler sets `Content-Disposition`, a non-JSON content type, or streams. `single record` for `/{id}`, `/current`, counts and stats, or an object response with no array fields. `UNBOUNDED whole list` when the response is an array (or `{data: []}`) with no pagination params, or the handler/service runs `findMany` without `take`. About 35 endpoints the schema did not settle were resolved by reading the handler/service and are annotated with the reason.
7. **POLL**: every `refreshInterval` and `setInterval` under `apps/web/src`, resolved to its SWR key or fetch target (see the POLL table for file:line). Polls driven only by IndexedDB/localStorage timers are excluded.
8. **Class**: three read-only POSTs (`/api/filters/ahu-completion-status/batch`, `/api/filters/ahu-set-availability`, `/api/config/user-id/validate`) are classed READ. HEAVY = path matches export / xlsx / csv / bulk / upload / backup / restore / verify-chain / import, or the handler reads multipart (`req.file()`, `req.parts()`, `readUpload`) or returns a file. `/api/config/*` and the notification read toggles are exempt from the path match. OP-WRITE = non-GET under `/api/filters`, `/api/pm-schedules`, `/api/pm-executions`, `/api/stage-approvals`, `/api/block-change-requests`, `/api/report-reviews`, `/api/replacement-schedules`, `/api/sync`, `/api/guest`, `/api/admin-requests`, `/api/auth`, or any `/review|approve|reject|resubmit|retire|replace|unretire` path. Every other non-GET is ADMIN-WRITE.

Generator scripts (scratch, not committed) lived in the session scratchpad. Re-derive after any route change; counts here are a snapshot.
