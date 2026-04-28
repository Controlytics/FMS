# API Endpoint Index

**Total registered HTTP endpoints:** 394 across 47 route files (verified via grep of `apps/api/src/modules/**/*.ts`, 2026-04-20).

All endpoints are mounted under `/api/...` unless noted. Prefixes come from `apps/api/src/app.ts` (`app.register(..., { prefix: ... })`). The list below groups endpoints by their **mount prefix**, so to derive the full URL, concatenate the prefix with each route path. A `*` marks an endpoint that is public (does not require a bearer token); everything else goes through `authPlugin` + `rbacPlugin`.

This file is an **index** — for handler-level detail (request/response shapes, permissions required per route), see `future/backend/API_ENDPOINTS.md`.

---

## Auth — `/api/auth`

- `POST /login`
- `POST /logout`
- `POST /refresh`
- `POST /beacon-logout`
- `GET  /me`
- `PUT  /profile`
- `POST /change-password`
- `POST /verify` (reauth)
- `POST /forgot-password` *

## Users — `/api/users`

- `POST /` — create user
- `GET  /` — list users
- `GET  /stats`
- `POST /bulk-delete`
- `GET  /:id`
- `PUT  /:id`
- `DELETE /:id`
- `POST /:id/enable | /disable | /unlock | /reset-password`
- `GET  /reset-requests` · `/reset-requests/pending` · `POST /reset-requests/:id/process`

## Roles — `/api/roles`

- `GET /` · `GET /active` * · `GET /permissions/all`
- `GET /:name` · `GET /:name/creatable`
- `POST /` · `PUT /:name` · `DELETE /:name`

## User groups — `/api/user-groups`

- `GET  /` · `POST /` · `PUT /:id` · `DELETE /:id`
- `GET  /:id/members` · `POST /:id/members` · `DELETE /:id/members/:userId`

## Config — `/api/config`

- Public reads: `/password-policy/current` * · `/report-settings/current` * · `/pagination/current` *
- Dynamic config (auto-registered per definition): `GET|PUT /:key`
- Core: `/dashboard-cards/current`, `PUT /dashboard-cards`
- Datetime: `/datetime/current`
- User-ID: `/user-id`, `PUT /user-id`, `/user-id/next`, `POST /user-id/validate`
- Branding: `/branding`, `PUT /branding`
- Roles config: `/roles`, `/roles/:role`, `PUT /roles/:role`
- Per-user: `/users/:userId`, `PUT /users/:userId`, `/my-config`
- Field IDs: `/field-ids`, `PUT /field-ids/:fieldId`
- Action reauth: `/action-reauth`, `PUT`, `/action-reauth/check`, `/action-reauth/my-actions`
- Audit templates: `/audit-templates`, `PUT`, `/audit-templates/current`
- Alarm columns: `/alarm-columns`, `PUT`, `/alarm-columns/current`
- Cleaning profile assignment: `/cleaning-profile-assignment`, `PUT`
- Tablet access: `/tablet-access`, `PUT`, `/tablet-access/my-features`
- Access matrix: `/access-matrix`, `PUT`, `/access-matrix/my-modules`
- Dynamic config registry: `/registry/manifest`, `GET|PUT /dynamic/:moduleKey`

## Audit — `/api/audit`

- `GET /` · `GET /:id`
- `DELETE /:id` · `POST /bulk-delete`

## Uploads — `/api/uploads`

- `POST /photo`

## Notifications — `/api/notifications`

- `GET /` · `GET /unread-count`
- `PUT /mark-all-read` · `PUT /bulk-read` · `PUT /bulk-unread` · `POST /bulk-delete`
- `PUT /:id/read` · `PUT /:id/unread` · `DELETE /:id`

## Notification settings — `/api/notification-settings`

- Email: `GET /email`, `PUT /email`, `POST /email/test`
- Email OAuth2: `/email/oauth2/redirect-uri`, `/email/oauth2/authorize`, `/email/oauth2/code`, `/email/oauth2/status`
- SMS: `GET /sms`, `PUT /sms`, `POST /sms/test`
- Send: `POST /send`
- Logs: `/logs`, `/logs/stats`, `DELETE /logs/:id`
- Templates: `/templates`, `POST`, `PUT /templates/:id`, `DELETE /templates/:id`

## Notification rules — `/api/notification-rules`

- `GET /event-types` · `GET /` · `GET /:id`
- `POST /` · `PUT /:id` · `DELETE /:id`
- `PUT /:id/toggle` · `POST /:id/test`

## Backup — `/api/backup`

- `GET /export` · `POST /restore` · `POST /validate`

## Assets — `/api/assets` (split across four route files)

- **Templates** (`template.routes.ts`): `GET /templates`, `POST`, `GET /templates/:id`, `PUT`, `DELETE`, `GET /templates/:id/versions`
- **Instances** (`instance.routes.ts`): `GET /instances`, `POST`, `GET /instances/tree`, `GET /instances/:id`, `POST /instances/bulk-upload-filters`, `PUT /instances/:id`, `PATCH /instances/:id/status`, `PATCH /instances/:id/lifecycle-state`, `DELETE /instances/:id`, `GET /instances/:id/children`
- **Relationships** (`relationship.routes.ts`): `GET /relationships`, `POST`, `DELETE /relationships/:id`
- **Identifiers** (`identifier.routes.ts`): `GET /identifiers`, `GET /identifiers/lookup/:value`, `POST /identifiers`, `DELETE /identifiers/:id`

## Internal MQTT auth — `/api/internal/mqtt`

- (EMQX webhook endpoints for auth/ACL — called by the broker, not the UI.)

## Data ingestion — `/api/data`

- `POST /telemetry` · `POST /attributes` · `GET /attributes`
- `POST /checklist`
- `POST /binary` · `GET /binaries/:entityId` · `GET /binaries/:entityId/file` · `DELETE /binaries/:entityId`
- `POST /event`
- `POST /rpc` · `GET /rpc/response/:requestId`

## Data-ingestion debug traces — `/api/debug/traces`

- `GET /` · `GET /stats` · `GET /:id` · `PUT /entity/:entityId/toggle`

## Rule chains — `/api/rule-chains`

- `GET /` · `GET /node-types` · `GET /:id`
- `POST /` · `PUT /:id` · `DELETE /:id`
- Nodes: `POST /:id/nodes`, `PUT /:id/nodes/:nodeId`, `DELETE /:id/nodes/:nodeId`
- Connections: `POST /:id/connections`, `DELETE /:id/connections/:connectionId`
- Save + debug: `POST /:id/save`, `GET /:id/debug`, `DELETE /:id/debug`

## UNS (unified namespace) — `/api/uns`

- `GET /tree` · `GET /search`
- `GET /entity/:entityId` · `PUT /entity/:entityId` · `DELETE /entity/:entityId`
- `POST /entity/:entityId/move` · `POST /entity/:entityId/move/confirm`

## Queries — `/api` (mounted at `/api/*` via `queriesModule`)

- **Telemetry** (`queries/telemetry.routes.ts`): `/telemetry/:entityId/latest`, `/timeseries`, `/keys`; `/attributes/:entityId/:scope`, `/attributes/:entityId/history`; `/checklist/:entityId/responses`, `/history`, `/responses/:checklistId`
- **Export** (`queries/export.routes.ts`): `/telemetry/:entityId`, `/checklist/:entityId`, `/alarms`, `/attributes/:entityId`, `/status/:jobId`
- **Retention** (`queries/retention.routes.ts`): `/config/retention`, `PUT`, `/retention/execute`, `/execute-range`, `/delete-keys`, `/delete-records`
- **Alarms** (`queries/alarm.routes.ts`): `/`, `/summary`, `/:entityId`, `POST /:id/acknowledge`, `POST /:id/clear`

## Connectivity — `/api/connectivity`

- `GET /:entityId` · `POST /:entityId/test` · `GET /:entityId/snippets`
- `POST /:entityId/token` · `DELETE /:entityId/token`
- `GET /:entityId/history`

## QR codes — `/api/qr`

- (one endpoint; see `modules/qr-code/routes.ts`)

## Help articles — `/api/help`

- `GET /` · `GET /:key`
- `POST /` · `PUT /:id` · `DELETE /:id`
- `GET /:id/versions`

## System health — `/api/system-health`

- `GET /` — aggregated service health

## Super-admin — `/api/super-admin`

- Organizations: `GET /organizations`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`
- `GET /stats`
- Filter data admin: retirements (`GET|PUT|DELETE|POST .../unretire`) and replacements (`GET|PUT|DELETE`)
- Data management console: `/data/cleaning-cycles`, `/data/filter-events`, `/data/audit-trail`, `/data/alarms`, `/data/notifications`, `/data/admin-requests`, `/data/block-change-requests`, `/data/pm-entries` — each supports `GET` (list), `PUT /:id` (edit), `DELETE /:id`

## LDAP — `/api/ldap`

- `GET /config` · `PUT /config` · `POST /test-connection` · `GET /status`

## Tenant admin — `/api/organizations`

- Base routes: `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `GET /info`
- Per-org detail (`org-detail-routes.ts`):
  - Users: `GET|POST /:orgId/users`, `PUT|DELETE /:orgId/users/:userId`
  - Entities: `GET|POST /:orgId/entities`, `DELETE /:orgId/entities/:entityId`
  - Templates: `GET|POST /:orgId/templates`, `DELETE /:orgId/templates/:templateId`
  - User-entity assignments: `GET|POST /:orgId/users/:userId/entities`, `DELETE .../:assignmentId`, `POST /.../templates`, `GET /.../visible-entities`

## Entity assignments — `/api/entity-assignments`

- `GET /my-entities`
- `GET /:entityId` · `POST /` · `POST /bulk` · `PUT /:id` · `DELETE /:id`

## Org admin — (mounted indirectly; see app.ts) 

- `GET /users` · `GET /entities` · `GET /info` (org-scoped read-only views)

## Dashboards — `/api/dashboards`

- `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`
- Widgets: `POST /:id/widgets`, `PUT /:id/widgets/:widgetId`, `DELETE /:id/widgets/:widgetId`
- Layout: `PUT /:id/layout`
- Assign: `POST /:id/assign`, `DELETE /:dashboardId/assign/:assignmentId`
- Data: `GET /:id/data/:widgetId`
- Widget catalog: `GET /widget-types`

## Cleaning profiles — `/api/filter-cleaning-profiles`

- `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `PATCH /:id/toggle-status` · `DELETE /:id`
- `GET /:id/assigned-assets` · `POST /:id/assign-assets`
- `POST /:id/validate`

## Checklist profiles — `/api/checklist-profiles`

- `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`
- Questions: `POST /:id/questions`, `PUT /:id/questions/:questionId`, `DELETE /:id/questions/:questionId`
- Reorder: `PUT /:id/reorder`

## Filter profiles — `/api/filter-profiles`

- `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`
- `POST /:id/assign`

## Filter operations — `/api/filters`

Core state machine for cleaning cycles; split across `routes.ts` and `events-routes.ts`.

- State: `GET /:id/current-state` · `GET /batch-states`
- Cycle: `POST /:id/start-cycle` · `POST /:id/advance` · `POST /:id/submit-checklist`
- `POST /:id/bypass` · `POST /:id/retire` · `POST /:id/replace` · `POST /:id/terminate-cycle`
- Lists: `GET /retirements` · `GET /replacements`
- Events & cycles (events-routes): `GET /events` · `GET /cycles` · `GET /cycles/:id` · `GET /dashboard-stats` · `GET /reasons`

## Equipment groups — `/api/equipment-groups`

- `GET /` · `GET /:id` · `GET /by-block/:blockId`
- `POST /` · `PUT /:id` · `DELETE /:id`

## PM schedules — `/api/pm-schedules` (+ execution routes at `/api/pm-executions`)

- Template + upload: `GET /template.csv`, `POST /upload`
- AHU configs: `GET /ahu-configs`, `PUT /ahu-configs/:ahuId`
- Entries: `GET /entries`, `GET /entries/pending-counts`, `POST /entries/approve`, `POST /entries/reject`, `POST /entries/:id/resubmit`, `PUT /entries/:id/edit`
- Due + history: `GET /due`, `GET /:entityId`, `GET /:entityId/history`
- CRUD: `POST /`, `PUT /:id`, `DELETE /:id`
- Executions (separate prefix): `POST /`, `PUT /:id`

## Report templates — `/api/report-templates`

- `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `PATCH /:id/toggle-status` · `DELETE /:id`
- Versions: `GET /:id/versions`, `GET /:id/versions/:version`
- `POST /:id/duplicate`

## Reports — `/api/reports`

- `POST /generate`
- `GET /` · `GET /:id` · `GET /:id/pdf` · `GET /:id/preview`
- `POST /:id/sign` · `POST /:id/reject` · `DELETE /:id`

## Deployment check — `/api/deployment-check`

- Dev/ops endpoint that verifies module wiring (used in CI/smoke tests).

## Admin requests — `/api/admin-requests`

- `POST /` — create request (create user / unlock / reset / modify)
- `GET /user-lookup` — look up existing user for modify requests
- `GET /` · `GET /pending-count`
- `POST /:id/process` — approve/reject & execute the action

## Block change requests — `/api/block-change-requests`

- `GET /` · `GET /pending-count`
- `POST /` · `POST /:id/approve` · `POST /:id/reject`

## WebSocket

- Mounted via `wsHandler` (see `apps/api/src/transport/ws-handler.ts`). Real-time entity updates for the SPA.

## Notes

- **394** endpoints is a count of `app.(get|post|put|patch|delete)(...)` declarations, including `dynamic-routes.ts` which programmatically registers config endpoints per config definition at startup. Actual runtime count is dependent on the number of active config definitions (+3 per definition: get/put/readonly registry).
- Full OpenAPI/Swagger spec is served at `/docs` when the API is running (`@fastify/swagger-ui`).
