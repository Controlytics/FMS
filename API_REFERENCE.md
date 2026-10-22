# DigiLog — API Reference

**Base URL:** `https://<server-ip>:3000/api` (Fastify direct; reverse proxy is optional / customer-choice after Phase 4 of the windows-friendly-rewrite)
**Authentication:** JWT Bearer token (header: `Authorization: Bearer <token>`)
**Content-Type:** `application/json`

## Authentication

### Login
```
POST /api/auth/login
Body: { username, password, force?, client? }
Response: { token, user: { id, username, fullName, role, forcePasswordChange }, expiresIn }
```
`force: true` terminates any existing session for this user.
`client: 'tablet'` (sent by the FilterOps app): a role whose tablet access has no `login` is refused with 403 `TABLET_ACCESS_DENIED` before any existing session is touched — so `force` cannot end the user's web session.

### Logout
```
POST /api/auth/logout
Auth: Bearer token
Response: { success: true }
```

### Refresh Token
```
POST /api/auth/refresh
Auth: Bearer token
Response: { token, expiresIn }
```

### Re-authenticate (for sensitive operations)
```
POST /api/auth/verify
Auth: Bearer token
Body: { password }
Response: { verified: true, verificationToken }
```
Verification token valid for 5 minutes. A gated write does NOT take this token: it takes the
PASSWORD itself, in the `x-reauth-password` header or the body field `_currentPassword`
(`lib/reauth-check.ts`; the gate strips `_currentPassword` before the handler runs).

In this file, `Reauth: X` = `enforceReauth(X)`: asked only of the roles the stored policy
(Config → Action Re-auth) lists for X. `Reauth always: X` = `enforceReauthAlways(X)`: asked of
EVERY caller, SUPER_ADMIN included, whatever the policy says. Since OD-01 (2026-10-22) every
action that destroys or rewrites a §11 record or changes the rules is `Reauth always`: audit
edit / redact / delete, every Filter Data Management write (`SUPER_ADMIN_DATA_EDIT`), user
delete and edit, per-user overrides, role create / edit / delete, role permission + sidebar saves,
the LDAP config, backup restore, Block/Area/AHU/filter delete, manual lifecycle moves, and the
re-auth policy save. The web client sends them, takes the 401 REAUTH_REQUIRED and retries signed;
only a file upload (backup restore) is asked up front.

### Get Current User
```
GET /api/auth/me
Auth: Bearer token
Response: { id, username, fullName, email, role, permissions[], scope }
```

### Change Password
```
POST /api/auth/change-password
Auth: Bearer token
Body: { currentPassword, newPassword }
Reauth: CHANGE_PASSWORD
```

### Forgot Password
```
POST /api/auth/forgot-password
Body: { username }
Response: 200 always (prevents user enumeration)
```

---

## Users

### List Users
```
GET /api/users?page=1&limit=20&search=john&status=ENABLED
Permission: USER_READ
Response: { data: User[], total, page, limit, totalPages }
```

### Create User
```
POST /api/users
Permission: USER_CREATE
Reauth: CREATE_USER
Body: { username, fullName, email, password, role, department? }
```

### Update User
```
PUT /api/users/:id
Permission: USER_UPDATE
Reauth always: UPDATE_USER (an edit can change the user's role)
Body: { fullName?, email?, role?, department?, status? }
```

### Delete User
```
DELETE /api/users/:id
Permission: SUPER_ADMIN only
Reauth always: DELETE_USER

POST /api/users/bulk-delete
Permission: SUPER_ADMIN only
Reauth always: BULK_DELETE_USERS
Body: { userIds: string[] }
```

### Enable/Disable/Unlock
```
POST /api/users/:id/enable     Permission: USER_ENABLE_DISABLE, Reauth: ENABLE_USER
POST /api/users/:id/disable    Permission: USER_ENABLE_DISABLE, Reauth: DISABLE_USER
POST /api/users/:id/unlock     Permission: USER_UNLOCK, Reauth: UNLOCK_USER
```

### Password Reset Requests
```
GET  /api/users/reset-requests                    Permission: USER_RESET_PASSWORD
GET  /api/users/reset-requests/pending             Permission: USER_RESET_PASSWORD
POST /api/users/reset-requests/:id/process         Permission: USER_RESET_PASSWORD, Reauth
Body: { action: "approve"|"reject", remarks? }
```

---

## Roles

```
GET    /api/roles                      Permission: ROLE_MANAGE
GET    /api/roles/active               Public (for dropdowns)
GET    /api/roles/:name                Permission: ROLE_MANAGE
POST   /api/roles                      Permission: ROLE_MANAGE, Reauth always: CREATE_ROLE
PUT    /api/roles/:name                Permission: ROLE_MANAGE, Reauth always: UPDATE_ROLE
DELETE /api/roles/:name                Permission: ROLE_MANAGE, Reauth always: DELETE_ROLE
GET    /api/roles/permissions/all      Permission: ROLE_MANAGE
```

---

## Configuration

### Static Config (per key)
```
GET /api/config/<key>                  Permission: CONFIG_READ
PUT /api/config/<key>                  Permission: CONFIG_UPDATE

Keys: password-policy, login-security, session, datetime, pagination,
      branding, user-id, report-config, tablet-access, cleaning-profile-assignment,
      audit-templates, action-reauth
      (alarm-columns removed 2026-05-17 with the alarm subsystem)

SUPER_ADMIN only (GET and PUT), whatever CONFIG_* a role holds:
  datetime        (2026-09-03)
  tablet-access   (2026-10-22, D03-15: which roles may sign in on a tablet;
                   GET /api/config/tablet-access/my-features stays open to every user)
PUT /api/config/cleaning-profile-assignment   SUPER_ADMIN only (2026-10-22, Filter Setup);
                   GET /api/config/cleaning-profile-assignment/current stays open to every user
GET/PUT /api/config/dynamic/<key>   — every key is requiredRole SUPER_ADMIN (incl. the
                   Role Assignments workflow keys and the block-change approval mode)
```

### Public Config (no auth)
```
GET /api/config/password-policy/current
GET /api/config/datetime/current
GET /api/config/pagination/current
GET /api/config/branding
GET /api/config/report-config/current
GET /api/config/audit-templates/current
GET /api/config/action-reauth/check?action=CREATE_USER
GET /api/config/action-reauth/my-actions   — policy-listed actions only; `Reauth always` actions are not in it
                                             (the client prompts on the server's 401 REAUTH_REQUIRED)
GET /api/config/tablet-access/my-features
GET /api/config/registry/manifest
GET /api/config/field-ids           — full records; requires CONFIG_READ
GET /api/config/field-ids/current   — {fieldId, displayName}[] for any signed-in user (what useFieldLabels reads)
```

### Role & User Config
```
GET /api/config/roles/:role            Permission: CONFIG_READ
PUT /api/config/roles/:role            Permission: ROLE_MANAGE, Reauth always: UPDATE_ROLE_CONFIG
GET /api/config/users/:userId          Permission: CONFIG_READ
PUT /api/config/users/:userId          Permission: ROLE_MANAGE, Reauth always: UPDATE_USER_CONFIG
PUT /api/config/action-reauth          Permission: ROLE_MANAGE, Reauth always: UPDATE_REAUTH_CONFIG
GET /api/ldap/config, GET /api/ldap/status, POST /api/ldap/test-connection   SUPER_ADMIN only (2026-10-22, D03-15)
PUT /api/ldap/config                   SUPER_ADMIN only (2026-10-22, D03-15), Reauth always: UPDATE_LDAP_CONFIG (the group -> role mapping)
POST /api/admin-requests/:id/process   Permission: ADMIN_REQUEST_APPROVE / ADMIN_REQUEST_REJECT (by action), Reauth: APPROVE_ADMIN_REQUEST;
                                       Reauth always [APPROVE_ADMIN_REQUEST, UPDATE_USER] when APPROVING a stored MODIFY_USER request whose modifyField is role
GET /api/config/my-config              Public
```

---

## Assets

### Templates
```
GET    /api/assets/templates           Permission: ASSET_VIEW
POST   /api/assets/templates           Permission: ASSET_TEMPLATE_CREATE, Reauth
PUT    /api/assets/templates/:id       Permission: ASSET_TEMPLATE_UPDATE, Reauth
DELETE /api/assets/templates/:id       Permission: ASSET_TEMPLATE_DELETE, Reauth
```

### Template Kinds (admin-editable lookup, Step 1 of architectural refactor)
```
GET    /api/template-kinds             Permission: ASSET_VIEW
POST   /api/template-kinds             Permission: CONFIG_UPDATE
PUT    /api/template-kinds/:code       Permission: CONFIG_UPDATE  (code is immutable; updates label/description/sortOrder/isActive)
DELETE /api/template-kinds/:code       Permission: CONFIG_UPDATE  (rejected with 409 SYSTEM_KIND for system kinds; rejected with 409 IN_USE if any AssetTemplate references this kind)
```
System kinds seeded by `prisma/seed.ts`: BLOCK · AREA · AHU · FILTER · EQUIPMENT · OTHER. Their `code` is the stable identifier the Filter Management / Cleaning Operations / Mobile pages compare against; admins can rename `label` but not `code`.

### Instances
```
GET    /api/assets/instances           Permission: ASSET_VIEW
GET    /api/assets/instances/:id       Permission: ASSET_VIEW
POST   /api/assets/instances           Permission: ASSET_CREATE, Reauth
PUT    /api/assets/instances/:id       Permission: ASSET_UPDATE, Reauth
DELETE /api/assets/instances/:id       Permission: ASSET_DELETE | FILTER_DELETE | FILTER_HIERARCHY_DELETE, Reauth always: DELETE_ASSET / DELETE_FILTER / DELETE_HIERARCHY_NODE
PATCH  /api/assets/instances/:id/lifecycle-state  Permission: FILTER_STATUS_UPDATE, Reauth always: UPDATE_FILTER_LIFECYCLE
DELETE /api/hierarchy/filters/:id      Permission: ASSET_DELETE | FILTER_DELETE, Reauth always: DELETE_ASSET / DELETE_FILTER
```

### Relationships
```
GET    /api/assets/relationships       Permission: ASSET_VIEW
POST   /api/assets/relationships       Permission: ASSET_RELATIONSHIP_CREATE, Reauth
DELETE /api/assets/relationships/:id   Permission: ASSET_RELATIONSHIP_DELETE, Reauth
```

### Identifiers (RFID, QR, Barcode)
```
GET    /api/assets/identifiers         Permission: ASSET_VIEW
POST   /api/assets/identifiers         Permission: ASSET_IDENTIFIER_CREATE, Reauth — one identifier per entity; `replaceExisting: true` swaps the held tag (released + audited in the same tx), else 409 ENTITY_HAS_IDENTIFIER
DELETE /api/assets/identifiers/:id     Permission: ASSET_IDENTIFIER_DELETE, Reauth
```

---

## Filter Operations

### Filter State
```
GET /api/filters/:id/current-state     Permission: ASSET_READ
Response: { filter, currentStage, nextActions[], pendingChecklist?, cycle? }
```

### Cleaning Cycle
```
POST /api/filters/:id/start-cycle      Permission: FILTER_OPERATE, Reauth: START_CLEANING_CYCLE
Body: { cleaningReasonKey, cleaningJustification?, equipmentGroupId? }

POST /api/filters/:id/advance          Permission: FILTER_OPERATE, Reauth: ADVANCE_FILTER_STAGE (+ the STAGE_* row of targetState)
Body: { targetState, tapeVersion, remarks?, equipmentGroupId?, instrumentReadings?, readingSources?,
        dryerAction?: 'SET_DURATION' | 'SUBMIT_READINGS', dryerDurationMinutes?, filterSet?: 'ALL' | 'SET_A' | 'SET_B',
        offlinePerformedAt?, clientOpId? }
  409 CHECKLIST_REQUIRED: into the LAST stage whose enabled checklist follows it (A-01) - use
  /advance-with-checklist. A final Dry In completes on its SUBMIT_READINGS call, never at dryer start.

POST /api/filters/:id/advance-with-checklist   Permission: FILTER_OPERATE,
     Reauth: ADVANCE_FILTER_STAGE + SUBMIT_CHECKLIST_WITH_SIGNATURE (+ the STAGE_* row of targetState)
Body: the /advance fields + { answers, expectedProfileVersions? } (required: targetState, answers, tapeVersion)
  The entry and the checklist after it are ONE transaction.

POST /api/filters/:id/bypass           Permission: FILTER_BYPASS, Reauth: BYPASS_FILTER_STAGE
                                       (+ SUBMIT_CHECKLIST_WITH_SIGNATURE when `answers` is sent)
Body: { targetState, justification (10+ chars), tapeVersion, parameters?, answers?, expectedProfileVersions?,
        filterSet?, offlinePerformedAt?, clientOpId? }
  Records a BYPASS_DEVIATION. Since 2026-10-22 it enters the target under the advance's rules
  (cycle-write/stage-entry.ts decideStageEntry): into the last stage it completes the cycle; with a
  checklist after that stage the answers ride in the same call (409 CHECKLIST_REQUIRED without them);
  into a QA-gated stage it raises the approval. No web or tablet page calls it today.

POST /api/filters/:id/submit-checklist Permission: FILTER_OPERATE, Reauth: SUBMIT_CHECKLIST_WITH_SIGNATURE
Body: { answers: { [questionId]: answer },
        offlinePerformedAt?: ISO timestamp,         // Phase 5b.1: regulatory time
        clientOpId?: UUID,                          // idempotent replay
        expectedProfileVersions?: { [profileId]: int } }  // Phase A.1: drift detection

Response 409 SCHEMA_DRIFT (Phase A.1) — body.details.drift = [{ profileId, expected, current }]
when client's expectedProfileVersions don't match the cycle's pinned versions.

POST /api/filters/bulk-operate          Permission: FILTER_OPERATE
Body: { items: [ { clientOpId, filterId, kind, payload?/cyclePayload?/advancePayload? } ] }  // 1–200 items
  kind = 'advance' | 'start-and-advance' | 'submit-checklist'  (bypass NOT supported)
  payloads carry the SAME fields (+ bounds) as the single /advance, /start-cycle, /submit-checklist routes.
Reauth: enforced ONCE over the union of the actions the batch's kinds imply
  (advance→ADVANCE_FILTER_STAGE, start-and-advance→START_CLEANING_CYCLE, submit-checklist→SUBMIT_CHECKLIST_WITH_SIGNATURE).
Processing: loops the existing single-op service methods, one transaction + one ordered audit row
  per item (hash chain intact). PARTIAL SUCCESS — one item failing does not affect the others.
Response 200: { results: [ { clientOpId, filterId, status: 'ok', snapshot } | { status: 'failed', error: { code, message } } ] }
  Each ok snapshot is the same post-write state (actions[] + tapeVersion) the single routes return.
Purpose: collapses the tablet's 50–100 tag batch submit from N sequential round-trips to ONE.

GET  /api/checklist-profiles/:id/versions          List archived versions
GET  /api/checklist-profiles/:id/versions/:n       Fetch immutable snapshot at version n
```

### Cycle & Event History
```
GET /api/filters/cycles                Permission: ASSET_READ
GET /api/filters/cycles/:cycleId       Permission: ASSET_READ
GET /api/filters/events                Permission: ASSET_READ
GET /api/filters/events/:eventId       Permission: ASSET_READ
```

---

## Cleaning Profiles

```
GET    /api/filter-cleaning-profiles                     Permission: FCP_READ | CP_TOGGLE
GET    /api/filter-cleaning-profiles/:id                 Permission: FCP_READ | CP_TOGGLE
GET    /api/filter-cleaning-profiles/:id/versions        Permission: FCP_READ | CP_TOGGLE     # Phase A.2
GET    /api/filter-cleaning-profiles/:id/versions/:n     Permission: FCP_READ | CP_TOGGLE     # Phase A.2 (frozen snapshot)
POST   /api/filter-cleaning-profiles                     Permission: FCP_CREATE | CP_PAGE_CREATE, Reauth
PUT    /api/filter-cleaning-profiles/:id                 Permission: FCP_UPDATE | CP_PAGE_EDIT, Reauth
DELETE /api/filter-cleaning-profiles/:id                 Permission: FCP_DELETE | CP_PAGE_DELETE, Reauth   # soft archive
PATCH  /api/filter-cleaning-profiles/:id/toggle-status   Permission: FCP_UPDATE | CP_PAGE_EDIT
POST   /api/filter-cleaning-profiles/:id/validate        Permission: FCP_READ | CP_TOGGLE
GET    /api/filter-cleaning-profiles/:id/assigned-assets Permission: FCP_READ | CP_TOGGLE
POST   /api/filter-cleaning-profiles/:id/assign-assets   Permission: FCP_UPDATE | CP_PAGE_EDIT
```

---

## Filter Profiles

`FilterProfile` binds a filter to a `FilterCleaningProfile` (plus block-restriction policy and applicable templates). Phase A.3 (2026-05-01) added a snapshot-then-bump version sidecar — every `update()` archives the OUTGOING state into `filter_profile_versions` and bumps `FilterProfile.version`. First version is created lazily (the live row IS v1 until first edit).

```
GET    /api/filter-profiles                              Permission: FP_READ
GET    /api/filter-profiles/:id                          Permission: FP_READ
GET    /api/filter-profiles/:id/versions                 Permission: FP_READ                     # Phase A.3
GET    /api/filter-profiles/:id/versions/:n              Permission: FP_READ                     # Phase A.3 (frozen snapshot)
POST   /api/filter-profiles                              Permission: FP_CREATE, Reauth
PUT    /api/filter-profiles/:id                          Permission: FP_UPDATE, Reauth          # snapshot-then-bump
DELETE /api/filter-profiles/:id                          Permission: FP_DELETE, Reauth          # hard delete; rejects if filters still assigned
POST   /api/filter-profiles/:id/assign                   Permission: FP_ASSIGN, Reauth
```

**Versioning notes:**
- `GET /:id/versions` returns `{ profileId, currentVersion, versions[] }` newest-first; `versions[]` carries metadata only (id, versionNumber, changeNotes, createdAt, createdBy).
- `GET /:id/versions/:n` returns the frozen snapshot fields (`name`, `description`, `cleaningProfileId`, `applicableTemplates`, `defaultPmScheduleId`, `blockRestriction`, `allowedBlocks`, `maxCleaningCycles`, `isActive`) plus `versionNumber`, `createdAt`, `createdBy`, `changeNotes`.
- 404 with `"Version N of filter profile … not found"` when the version number is out of range.
- No cycle-side pin map is needed — cycles already pin `cleaning_cycles.profileId` to a `FilterCleaningProfile` row at start, so FilterProfile drift cannot reach an in-flight cycle.

---

## Equipment Groups

`EquipmentGroup` is a per-block group with exactly 3 instruments (Compressed Air Pressure / RO Water Pressure / Dryer Temperature). Phase A.4 (2026-05-02) added a composite-snapshot version sidecar — every `update()` archives the OUTGOING composite (group + 3 instruments together) into `equipment_group_versions` and bumps `EquipmentGroup.version`. First version is created lazily (the live composite IS v1 until first edit). Cycles do NOT pin a group version; submitted reading drift is already covered by `FilterEvent.attributes.instrumentReadings` (immutable).

```
GET    /api/equipment-groups                            Permission: ASSET_READ | EG_VIEW
GET    /api/equipment-groups/:id                        Permission: ASSET_READ | EG_VIEW
GET    /api/equipment-groups/by-block/:blockId          Permission: ASSET_READ | EG_VIEW
GET    /api/equipment-groups/:id/versions               Permission: ASSET_READ | EG_VIEW                  # Phase A.4
GET    /api/equipment-groups/:id/versions/:n            Permission: ASSET_READ | EG_VIEW                  # Phase A.4 (frozen composite)
POST   /api/equipment-groups                            Permission: ASSET_CREATE | EG_CREATE, Reauth
PUT    /api/equipment-groups/:id                        Permission: ASSET_UPDATE | EG_EDIT, Reauth        # snapshot-then-bump composite
DELETE /api/equipment-groups/:id                        Permission: ASSET_DELETE | EG_DELETE, Reauth      # soft-delete (isActive=false); rejects if active cycles reference
```

**Versioning notes:**
- `GET /:id/versions` returns `{ groupId, currentVersion, versions[] }` newest-first; `versions[]` carries metadata only.
- `GET /:id/versions/:n` returns the frozen composite snapshot: `{ groupId, versionNumber, name, blockId, isActive, instruments[] (ordered by sortOrder, full instrument shape), createdAt, createdBy, changeNotes }`.
- 404 with `"Version N of equipment group … not found"` when out of range.
- Cleaning reasons (config def `filter-cleaning-reasons`) are NOT versioned — `CleaningCycle.cleaningReasonKey` + `cleaningReasonLabel` columns written at cycle start act as the per-cycle pin (see `CHANGELOG.md` Phase A.4 entry for rationale).

---

## PM Schedules

Routes as registered in `apps/api/src/modules/pm-schedules/routes.ts` and
`execution-routes.ts` (verified 2026-10-22). "Reauth" = `enforceReauth(<action>)`
(asks for the password only when the row is on for the role on Config → Action
Re-auth); "Reauth always" = `enforceReauthAlways`. Schedule and entry routes call
`checkPmEnabled()` and answer 404 `PM_DISABLED` while the PM module is off;
`/settings` reports the flag.

```
GET    /api/pm-schedules/settings                       PM_READ
GET    /api/pm-schedules/workflow-config                PM_READ
GET    /api/pm-schedules/template.csv                   PM_READ or PM_DOWNLOAD_TEMPLATE
POST   /api/pm-schedules/upload                         PM_UPLOAD, Reauth UPLOAD_PM_SCHEDULES
GET    /api/pm-schedules/ahu-configs                    PM_READ
PUT    /api/pm-schedules/ahu-configs/:ahuId             PM_UPDATE, Reauth UPDATE_CONFIG_PAGE

GET    /api/pm-schedules/entries                        PM_READ
GET    /api/pm-schedules/entries/pending-counts         PM_READ
GET    /api/pm-schedules/entries/export.xlsx            PM_READ, Reauth EXPORT_PM_SCHEDULE
POST   /api/pm-schedules/entries/review                 PM_REVIEW, Reauth REVIEW_PM_SCHEDULE
POST   /api/pm-schedules/entries/approve                PM_APPROVE, Reauth APPROVE_PM_SCHEDULE
POST   /api/pm-schedules/entries/reject                 PM_APPROVE, Reauth REJECT_PM_SCHEDULE
POST   /api/pm-schedules/entries/:id/resubmit           PM_RESUBMIT, Reauth RESUBMIT_PM_ENTRY
PUT    /api/pm-schedules/entries/:id/edit               PM_EDIT_ENTRY, Reauth EDIT_PM_SCHEDULE
PUT    /api/pm-schedules/entries/:id/review-edit        PM_REVIEW, Reauth REVIEW_PM_SCHEDULE

POST   /api/pm-schedules/deviations/sweep               PM_UPDATE
GET    /api/pm-schedules/deviations                     PM_READ
POST   /api/pm-schedules/deviations/:id/acknowledge     PM_EXECUTE, Reauth always ACKNOWLEDGE_PM_OVERDUE
GET    /api/pm-schedules/pending-tasks-map              PM_READ
GET    /api/pm-schedules/due                            PM_READ

GET    /api/pm-schedules/qnn/visible                    signed in
GET    /api/pm-schedules/qnn                            role in qnn-notifications.visibleRoles (+ SUPER_ADMIN), else 403

GET    /api/pm-schedules/:entityId?year=YYYY            PM_READ  — the ACTIVE schedule, or null when there is none
GET    /api/pm-schedules/:entityId/history              PM_READ
POST   /api/pm-schedules                                PM_CREATE, Reauth CREATE_PM_SCHEDULE
POST   /api/pm-schedules/visits                         PM_CREATE, Reauth CREATE_PM_SCHEDULE
PUT    /api/pm-schedules/:id                            PM_UPDATE, Reauth UPDATE_PM_SCHEDULE
DELETE /api/pm-schedules/:id                            SUPER_ADMIN only, Reauth DELETE_PM_SCHEDULE

POST   /api/pm-executions                               PM_EXECUTE, Reauth START_PM_TASK
```

**Creating visits — the same rules on every door** (upload, `POST /visits`, `POST /`):
- **Upload role.** Each runs `assertPmRole(role, uploadRole, 'upload')` — step 1
  of the segregation-of-duties chain (403 `FORBIDDEN_ROLE`; a no-op when no
  upload role is configured; SUPER_ADMIN exempt). `POST /` gained this on
  2026-10-22.
- **Approval fields** (`pm-submission.ts`, `submissionApprovalFields`). Workflow
  ON: every new visit is `PENDING_REVIEW` with `submittedBy`/`submittedByName`
  (no bypass, not even for SUPER_ADMIN). Workflow OFF: SUPER_ADMIN's visit is
  `APPROVED` with `approvedBy`/`approvedByName`/`approvedAt`; anyone else's is
  `PENDING` with its submitter. Until 2026-10-22 `POST /` wrote the column
  default (`PENDING`, no submitter) whatever the workflow said, so with the
  workflow ON its entries skipped Review.
- **Next version** (`pm-schedule-version.ts`). A new schedule for an (AHU, year)
  takes the latest version + 1, never the default 1 — an AHU-year can hold
  ARCHIVED versions with no ACTIVE one, and v1 collided with
  `@@unique([entityId, year, version])`.
- **UTC dates.** A visit's year and month are read in UTC (planned dates are
  stored at UTC midnight).

**`POST /api/pm-schedules/visits`** — add ONE visit (the web New Schedule
dialog; operator decision 2026-10-22, D-OPS-10):
```
Body: { entityId: uuid (an active AHU), plannedDate: "YYYY-MM-DD", toleranceDays?: 0..365 }
      toleranceDays defaults to pm-schedule-settings.defaultToleranceDays.
201:  { scheduleId, scheduleCreated: boolean, entry: PmScheduleEntry, qnn }
404 NOT_FOUND         entityId is not an active AHU
409 PM_VISIT_EXISTS   that date is already on the AHU's schedule for the year
409 PM_VISIT_OVERLAP  the visit's window (plannedDate ± toleranceDays) overlaps
                      another visit's (pre-existing overlaps between OTHER visits
                      stay grandfathered)
409 CONFLICT          the year's schedule was created concurrently — retry
```
Adds the visit to the AHU's ACTIVE schedule for the year of `plannedDate`,
creating the schedule (next version) in the same transaction when there is none.
Existing visits are never changed — to move one, use
`PUT /entries/:id/edit` (approved) or `/resubmit` (rejected). Writes one
`CREATED` audit row (`targetType: pm_schedule_entry`) in the transaction and mints
one QNN (`UPLOAD`) for the entry, as the upload does per row.

**`POST /api/pm-schedules`** — create the year's schedule with its entries.
409 `CONFLICT` when the AHU already has an ACTIVE schedule for the year (use
`POST /visits` to add to it); 409 `PM_VISIT_OVERLAP` when two of the given
entries overlap.

---

## Audit Trail

```
GET    /api/audit?page=1&limit=20&search=&period=7d&action=CREATED
Permission: AUDIT_READ
Response: { data: AuditEntry[], total, page, limit }

Filters: period (1d,7d,30d,90d), startDate, endDate, search, userId,
         action, targetType, targetId
Sort: timestamp, action, userId, userRole

POST   /api/audit/:id/redact      SUPER_ADMIN only, Reauth always: REDACT_AUDIT_RECORD        Body: { reason }
POST   /api/audit/bulk-redact     SUPER_ADMIN only, Reauth always: BULK_REDACT_AUDIT_RECORDS  Body: { ids, reason }
PUT    /api/audit/:id             SUPER_ADMIN only, Reauth always: UPDATE_AUDIT_RECORD        Body: { reason, ...fields }  (breaks the hash chain)
DELETE /api/audit/:id             AUDIT_DELETE,     Reauth always: DELETE_AUDIT_RECORD        Body: { reason }             (breaks the hash chain)
POST   /api/audit/bulk-delete     AUDIT_DELETE,     Reauth always: BULK_DELETE_AUDIT_RECORDS  Body: { ids, reason }        (breaks the hash chain)
```

Filter Data Management (`/api/super-admin/filter-data/*`, `/api/super-admin/data/*`) and the
Super Admin record edits on the user-facing pages: every POST / PUT / DELETE is SUPER_ADMIN only,
`Reauth always: SUPER_ADMIN_DATA_EDIT`, and needs `_changeReason` (min 5 chars).

---

## Backup

```
GET  /api/backup/export?format=json|sql|csv|bak
Permission: CONFIG_UPDATE, Reauth: EXPORT_BACKUP
Response: File download

POST /api/backup/restore
Permission: BACKUP_RESTORE, Reauth always: RESTORE_BACKUP (checked before the upload is read)
Body: multipart/form-data (backup file)

POST /api/backup/validate
Permission: CONFIG_UPDATE
Body: multipart/form-data (backup file)
```

---

## Notifications

```
GET    /api/notifications?page=1&limit=20&isRead=false
GET    /api/notifications/unread-count
PUT    /api/notifications/mark-all-read
PUT    /api/notifications/:id/read
PUT    /api/notifications/:id/unread
DELETE /api/notifications/:id
```

## Notification Settings

```
GET    /api/notification-settings/email                     CONFIG_READ (secrets masked)
PUT    /api/notification-settings/email                     CONFIG_UPDATE · Reauth: UPDATE_EMAIL_CONFIG
POST   /api/notification-settings/email/test                CONFIG_UPDATE · Body: { recipient? }
GET    /api/notification-settings/email/oauth2/redirect-uri CONFIG_READ
GET    /api/notification-settings/email/oauth2/authorize    CONFIG_UPDATE
GET    /api/notification-settings/email/oauth2/code         no JWT (OAuth2 provider redirect; checks the stored state)
GET    /api/notification-settings/email/oauth2/status       CONFIG_READ
GET    /api/notification-settings/sms                       CONFIG_READ (secrets masked)
PUT    /api/notification-settings/sms                       CONFIG_UPDATE · Reauth: UPDATE_SMS_CONFIG
POST   /api/notification-settings/sms/test                  CONFIG_UPDATE · Body: { recipient }
GET    /api/notification-settings/logs                      CONFIG_READ
GET    /api/notification-settings/logs/stats                CONFIG_READ
DELETE /api/notification-settings/logs/:id                  CONFIG_UPDATE · Reauth: DELETE_NOTIFICATION_LOG
GET    /api/notification-settings/templates                 CONFIG_READ
POST   /api/notification-settings/templates                 CONFIG_UPDATE
PUT    /api/notification-settings/templates/:id             CONFIG_UPDATE
DELETE /api/notification-settings/templates/:id             CONFIG_UPDATE
```
- **Test-sends are audited (SEC-03, 2026-10-22).** Every `/email/test` and `/sms/test` call writes one
  `NOTIFICATION_TEST_SENT` row: who, `targetId` `notification-email` / `notification-sms`, and
  `afterValue { channel, recipient, mode: SEND | CONNECTION_CHECK, success }`. `/email/test` without a
  recipient is the SMTP connection check (`recipient: null`). The row never holds the error text or any
  config value, because a delivery error can echo an http-gateway URL that carries an API key. The error
  is in the response and in the delivery log. A refused request (400 / 403) writes no row.
- **`POST /api/notification-settings/send` was removed 2026-10-22 (SEC-03).** It sent any e-mail or SMS
  to any recipient with no signature, no audit row and no sender recorded, and nothing called it. It now
  answers like any unknown path (404).

---

## Error Response Format

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Username already exists",
  "details": { "field": "username" }
}
```

Common error codes:
- `UNAUTHORIZED` (401) — missing or invalid token
- `FORBIDDEN` (403) — insufficient permissions
- `NOT_FOUND` (404) — resource doesn't exist
- `VALIDATION_ERROR` (400) — invalid request body
- `SESSION_CONFLICT` (409) — another session exists
- `TABLET_ACCESS_DENIED` (403) — `POST /api/auth/login` with `client: 'tablet'` for a role whose tablet access has no `login` (checked before any existing session is touched)
- `INTERNAL_ERROR` (500) — server error

---

## Permission Reference (102 total — verified by `grep -cE "^\s+[A-Z_]+:\s*'" packages/shared/src/types/permissions.ts`; the list below is illustrative grouping, not exhaustive)

### User Management
`USER_CREATE`, `USER_READ`, `USER_UPDATE`, `USER_DELETE`, `USER_ENABLE_DISABLE`, `USER_UNLOCK`, `USER_RESET_PASSWORD`

### Configuration
`CONFIG_READ`, `CONFIG_UPDATE`, `FIELD_ID_UPDATE`, `ROLE_MANAGE`

### Assets
`ASSET_READ`, `ASSET_VIEW`, `ASSET_CREATE`, `ASSET_UPDATE`, `ASSET_DELETE`, `ASSET_TEMPLATE_CREATE`, `ASSET_TEMPLATE_UPDATE`, `ASSET_TEMPLATE_DELETE`, `ASSET_RELATIONSHIP_CREATE`, `ASSET_RELATIONSHIP_DELETE`, `ASSET_IDENTIFIER_CREATE`, `ASSET_IDENTIFIER_DELETE`, `ENTITY_ASSIGN`

### Filter Operations
`FILTER_OPERATE`, `FILTER_BYPASS`, `FILTER_BULK_UPLOAD`, `FILTER_RETIRE`, `FILTER_REPLACE`, `FILTER_STATUS_UPDATE`, `FILTER_HIERARCHY_CREATE`, `FILTER_RFID_MANAGE`

### Cleaning Profiles
`FCP_READ`, `FCP_CREATE`, `FCP_UPDATE`, `FCP_DELETE`, `CP_TOGGLE`, `CP_PAGE_CREATE`, `CP_PAGE_EDIT`, `CP_PAGE_DELETE`

### Checklists
`CHECKLIST_SUBMIT`, `CHECKLIST_CREATE`, `CHECKLIST_EDIT`, `CHECKLIST_DELETE`, `CHECKLIST_TOGGLE`

### PM Schedules
`PM_READ`, `PM_CREATE`, `PM_UPDATE`, `PM_DELETE`, `PM_EXECUTE`, `PM_APPROVE`, `PM_REVIEW`, `PM_DOWNLOAD_TEMPLATE`, `PM_UPLOAD`, `PM_EDIT_ENTRY`, `PM_RESUBMIT`

### Reports
`REPORT_GENERATE`, `REPORT_EXPORT`, `REPORT_REVIEW_SUBMIT`, `REPORT_REVIEW`, `REPORT_APPROVE` (report generate/sign template perms `REPORT_TEMPLATE_*` / `REPORT_VIEW` / `REPORT_SIGN` / `REPORT_DELETE` removed 2026-07-04; `REPORT_GENERATE`/`REPORT_EXPORT` now gate the cleaning-record + lifecycle PDF export)

### Other
`AUDIT_READ`, `AUDIT_EXPORT`, `EVENT_READ`, `CYCLE_READ`, `NOTIFICATION_VIEW`, `NOTIFICATION_CREATE`, `NOTIFICATION_UPDATE`, `NOTIFICATION_DELETE`, `NOTIFICATION_MANAGE`, `DASHBOARD_CREATE`, `DASHBOARD_MANAGE`, `DASHBOARD_VIEW`, `DASHBOARD_ASSIGN`, `READ_DEBUG_TRACE`, `MANAGE_DEBUG_TRACE`, `BLOCK_CHANGE_REQUEST`, `BLOCK_CHANGE_APPROVE`, `BACKUP_MANAGE`, `EG_VIEW`, `EG_CREATE`, `EG_EDIT`, `EG_DELETE`, `FP_READ`, `FP_CREATE`, `FP_UPDATE`, `FP_DELETE`, `FP_ASSIGN`

> **Removed:** `ALARM_VIEW/ACKNOWLEDGE/CLEAR` + `RULE_CHAIN_VIEW/CREATE/UPDATE/DELETE` (rule-chain + alarm tear-out, 2026-05-17); `UNS_VIEW/UNS_MANAGE` (data-ingestion tear-out, 2026-06-17).

> **Note (MT removal 2026-04-30):** `ORG_MANAGE`, `ORG_VIEW`, `ORG_CREATE`, `ORG_DELETE` permissions and the `/api/organizations` + `/api/org-admin` + `/api/tenant-admin` route prefixes were deleted. DigiLog is now single-tenant.
