# Feature Status

## Completed Features

| Feature | Status | Notes |
|---------|--------|-------|
| User Authentication (local) | Done | BCrypt, JWT, session management |
| LDAP/AD Integration | Done | Auto-provisioning, group mapping, attribute sync |
| Organization-Based Architecture | Done | SUPER_ADMIN > Organization > User hierarchy |
| Role-Based Access Control | Done | 7 roles, 61 permissions, hierarchy enforcement |
| User Management | Done | CRUD, bulk delete, enable/disable, lock/unlock |
| Organization Management | Done | CRUD, delete with user unassign, active/inactive |
| Asset Template Management | Done | Create, version, attributes, telemetry keys |
| Asset Instance Management | Done | CRUD, relationships, identifiers, hierarchy |
| Rule Chain Engine | Done | 77 node types, visual editor, debug mode |
| Data Ingestion (MQTT) | Done | EMQX integration, device auth, rate limiting |
| Data Ingestion (HTTP) | Done | REST API with device token auth |
| TimescaleDB Telemetry | Done | Batched writes, hypertables, retention |
| Alarm Management | Done | Create, acknowledge, clear with e-signatures |
| Notification System | Done | In-app, email, SMS channels |
| Notification Rules | Done | Event-based triggers with conditions |
| Audit Trail | Done | Immutable logs, export, IP tracking |
| Electronic Signatures | Done | 21 CFR Part 11 compliant (SHA-256) |
| Checklist System | Done | 3-step approval workflow |
| QR Code Generation | Done | Asset identification scanning |
| Dashboard Widgets | Done | Configurable, real-time data |
| WebSocket Real-time | Done | Live telemetry, alarm, notification updates |
| Password Policy | Done | Complexity, expiry, history, lockout |
| Session Management | Done | Sliding window, absolute timeout, single-tab |
| Configuration System | Done | 22 auto-discovered config modules |
| Branding | Done | Per-organization logo, colors, app name |
| System Health Monitoring | Done | API metrics, request tracking |
| Database Backup | Done | Manual backup/restore |
| Help Documentation | Done | Contextual help with version history |
| UNS (ISA-95 Paths) | Done | Entity to UNS path mapping |
| Debug Traces | Done | Pipeline execution debugging |

## Partially Completed

| Feature | Status | Missing |
|---------|--------|---------|
| Data Retention | 80% | Auto-cleanup scheduled but not all modules |
| SMS Notifications | 80% | Gateway integration needs per-deployment config |
| Telegram/Slack | 70% | Basic implementation, no OAuth for Slack |

---

### Detailed Gap Analysis for Partially Completed Features

---

#### 1. Data Retention (80%) -- Remaining Gaps

**What exists:**
- `apps/api/src/modules/queries/retention.routes.ts`: Full CRUD API for retention config (GET/PUT `/config/retention`)
- Manual execution endpoints: `POST /retention/execute` (delete by age), `POST /retention/execute-range` (delete by time range), `POST /retention/delete-keys` (delete specific keys), `POST /retention/delete-records` (delete individual records)
- Covers 5 TSDB tables: `ts_telemetry`, `ts_attributes`, `ts_device_events`, `ts_pipeline_traces`, `ts_checklist_responses`
- Also handles alarm deletion from main PostgreSQL DB
- Frontend config page at `/config/retention` (`apps/web/src/routes/config/retention.tsx`) with full UI for editing policies and manual execution
- `autoEnabled` boolean flag stored in config

**What is missing (the 20%):**

1. **No automated/scheduled retention job**: The `autoEnabled` flag is stored and displayed in the UI, but there is NO cron job, BullMQ repeatable job, or `setInterval` that reads this flag and automatically executes retention. The `apps/api/src/workers/maintenance.worker.ts` only handles two tasks: `dlq_check` and `connectivity_check` -- it has no retention task. Toggling `autoEnabled: true` in the UI has zero effect on actual data deletion. **Fix:** Add a `retention_cleanup` repeatable job to `maintenance.worker.ts` that reads the retention config, checks `autoEnabled`, and runs DELETE queries against each TSDB table based on configured retention periods.

2. **No retention for audit logs**: The `AuditLog` table (PostgreSQL) has no retention policy or cleanup endpoint. Audit logs grow indefinitely. The retention system only covers TSDB hypertables + alarms. **Fix:** Add `auditLogs: { retentionDays: number }` to the retention config schema and add `audit_log` to the TSDB_TABLE_MAP (or handle via Prisma since it is in PostgreSQL).

3. **No retention for notification logs**: The `NotificationLog` table (PostgreSQL) has no automated cleanup. Old delivery logs accumulate without limit. There is a single-record delete endpoint (`DELETE /notification-logs/:id` in `notification-delivery/routes.ts`) but no bulk age-based purge. **Fix:** Add `notificationLogs: { retentionDays: number }` to the retention config and a bulk delete endpoint.

4. **No retention for session records**: Expired session records in PostgreSQL have no cleanup mechanism. **Fix:** Add session cleanup to the maintenance worker or retention system.

5. **No data archival/export-before-delete**: The `requiresArchive` flag is stored in config and shown in UI, but there is no archive implementation. No endpoint creates a backup/export of data before deletion. The flag is purely cosmetic -- the `POST /retention/execute` and `POST /retention/execute-range` endpoints delete data regardless of the `requiresArchive` value. **Fix:** Implement a `POST /retention/archive` endpoint that exports data to CSV/JSON before deletion, and make the execute endpoints check the flag.

6. **No retention execution history/logging**: There is no dedicated record of when retention was executed, what was deleted, or by whom. Manual executions return a count but do not persist a retention history entry. **Fix:** Create a `retention_executions` table or log entries to track execution history.

---

#### 2. SMS Notifications (80%) -- Remaining Gaps

**What exists:**
- `apps/api/src/modules/notification-delivery/channels/sms-channel.ts`: Full implementation with 4 providers -- Twilio (REST API), AWS SNS (CLI-based), Vonage/Nexmo (REST API), HTTP Gateway (generic webhook)
- Phone number normalization with configurable default country code and E.164 validation
- Message truncation to 1600 chars, HTML tag stripping
- `testConnection()` method for credential validation
- Config loader with in-memory caching (`config-loader.ts`)
- Delivery service (`delivery.service.ts`) with retry logic (3 retries, exponential backoff: 5s/15s/45s)
- Notification dispatcher integrates SMS -- looks up user phone from `systemConfig` table (`user-phone-{userId}`)
- Frontend SMS settings page at `/config/sms-settings` (`apps/web/src/routes/config/notification-settings/sms-settings.tsx`) with all 4 provider UIs
- Config definition at `apps/api/src/modules/config/defs/notification-sms.def.ts`

**What is missing (the 20%):**

1. **Config definition only lists 2 of 4 providers**: `notification-sms.def.ts` provider select options only include `aws-sns` and `twilio`. The backend supports `vonage` and `http-gateway` too, but these are missing from the config def options array. The custom SMS settings page does show all 4, so this is a minor inconsistency in the auto-discovery config. **Fix:** Add `{ value: 'vonage', label: 'Vonage' }` and `{ value: 'http-gateway', label: 'HTTP Gateway' }` to the options array in `notification-sms.def.ts`.

2. **No per-organization SMS config**: SMS config is system-wide (single `SystemConfig` record with key `notification-sms`). There is no organization-level override for SMS provider, sender ID, or credentials. All organizations share one SMS gateway. **Fix:** Support `notification-sms-org-{orgId}` config keys with fallback to the global config.

3. **No user phone number management UI**: Phone numbers are stored in `systemConfig` as `user-phone-{userId}`, but there is no dedicated UI on the user profile page or admin user-edit page to view/edit phone numbers. Phone numbers must be set via direct API call or database manipulation. **Fix:** Add a phone number field to the user profile page (`apps/web/src/routes/profile/`) and to the admin user-edit form.

4. **AWS SNS uses shell exec (`execSync`) instead of SDK**: The `sendViaAwsSns()` function in `sms-channel.ts` at line 61 shells out to the `aws` CLI via `child_process.execSync` with a 15-second timeout. This blocks the Node.js event loop, requires the AWS CLI binary to be installed on the server, and is not production-grade. **Fix:** Replace with `@aws-sdk/client-sns` `PublishCommand` which is async and does not require the CLI.

5. **No delivery status webhooks/callbacks**: None of the 4 providers have incoming webhook handlers to receive delivery receipts (Twilio StatusCallback URL, AWS SNS delivery status topics, Vonage DLR webhooks). The system marks an SMS as "SENT" when the provider API returns 200, but cannot track whether the SMS was actually delivered to the handset. **Fix:** Add webhook endpoints for each provider to receive delivery status updates and update `NotificationLog.status` accordingly.

6. **No SMS rate limiting or cost controls**: No per-user or per-organization SMS send limits. No daily/monthly cap to prevent runaway costs from notification rule loops or misconfigured rules. **Fix:** Add configurable rate limits (e.g., max SMS per user per hour, max SMS per org per day) to the SMS config.

---

#### 3. Telegram/Slack (70%) -- Remaining Gaps

**What exists:**
- **Slack**: A single rule-chain node (`send-to-slack` at line 1793 of `apps/api/src/modules/rule-chain/nodes/index.ts`) that sends a JSON payload to a Slack incoming webhook URL. Supports `webhookUrl`, `channel`, and `message` config fields.
- **Telegram**: Nothing. Zero Telegram code exists anywhere in the codebase.

**What is missing (the 30%):**

1. **No Telegram implementation at all**: Despite being listed as partially complete, there is zero Telegram code anywhere in the codebase. No rule-chain node (no `send-to-telegram` in `rule-chain/nodes/index.ts`), no notification channel file, no bot token config, no Telegram Bot API integration. **Fix:** Create `send-to-telegram` rule-chain node using the Telegram Bot API `sendMessage` endpoint, and create `telegram-channel.ts` in `notification-delivery/channels/`.

2. **No Slack or Telegram notification delivery channel**: Neither `slack-channel.ts` nor `telegram-channel.ts` exists in `apps/api/src/modules/notification-delivery/channels/`. Only `email-channel.ts` and `sms-channel.ts` exist. The `delivery.service.ts` channel map at line 13 only registers `{ EMAIL: emailChannel, SMS: smsChannel }`. The `NotificationPayload` type in `types.ts` restricts channel to `'EMAIL' | 'SMS'`. **Fix:** Create both channel files, add `SLACK` and `TELEGRAM` to the `NotificationPayload.channel` union type, and register them in `delivery.service.ts`.

3. **No Slack/Telegram in notification rules system**: The `NotificationRule` Prisma model (`apps/api/prisma/schema.prisma`) has `emailEnabled`, `smsEnabled`, and `inAppEnabled` boolean flags but no `slackEnabled` or `telegramEnabled`. The notification dispatcher (`notification-dispatcher.ts`) only dispatches to email, SMS, and in-app channels. **Fix:** Add `slackEnabled`/`telegramEnabled` columns via Prisma migration, add Slack/Telegram dispatch logic to `notification-dispatcher.ts`, and update the notification rules frontend form.

4. **No Slack OAuth2 / Bot Token integration**: The existing Slack rule-chain node only supports pasting an incoming webhook URL manually. There is no OAuth2 install flow for Slack apps, no Slack Bot Token management, no interactive channel picker, and no Slack Events API subscription. **Fix:** Implement Slack OAuth2 flow with `client_id`/`client_secret` config, token storage, and a channel list API.

5. **No config/settings pages for Slack or Telegram**: No frontend configuration page exists for either service. No config definition file exists in `apps/api/src/modules/config/defs/` (no `notification-slack.def.ts` or `notification-telegram.def.ts`). **Fix:** Create config def files and corresponding settings pages at `/config/slack-settings` and `/config/telegram-settings`.

6. **No Slack/Telegram user mapping**: No mechanism to associate a DigiLog user with their Slack user ID or Telegram chat ID for direct/personal messaging. The Slack rule-chain node only posts to channels. **Fix:** Add `slackUserId` and `telegramChatId` fields to user config (similar to `user-phone-{userId}` pattern) and add a UI for users to link their accounts.

7. **Slack rule-chain node is webhook-only with basic formatting**: The `send-to-slack` node sends a plain `{ text, channel }` JSON payload. It does not support Slack Block Kit rich formatting, attachments, action buttons, or threaded replies. **Fix:** Add Block Kit support with optional `blocks` JSON config field.

---

## Not Yet Implemented

| Feature | Priority | Notes |
|---------|----------|-------|
| SSO (SAML/OAuth2) | Medium | Currently LDAP only |
| Mobile App | Low | Responsive web works on mobile |
| Report Generation | Medium | PDF/Excel report exports |
| Data Analytics | Low | Basic queries exist, no BI integration |
| Multi-Region | Low | Single-server deployment |
| API Rate Limiting Per Organization | Medium | Currently global only |
| Automated Backups | Medium | Currently manual only |
