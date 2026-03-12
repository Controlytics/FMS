# System Configuration

DigiLog provides a centralized configuration system for customizing platform behavior. All configuration changes are recorded in the audit trail.

---

## Configuration Pages

Access configuration from the **Configuration** menu in the left sidebar.

### Available for ADMIN and above

| Page | Description |
|------|-------------|
| **Password Policy** | Password complexity, expiry, reuse prevention |
| **Date & Time** | Display format, timezone settings |
| **Backup & Restore** | Database backup and restore operations |

### Available for SUPER_ADMIN only

| Page | Description |
|------|-------------|
| **Branding** | Application name, logo, favicon |
| **Role Privileges** | View and modify role permission assignments |
| **Roles Management** | Role hierarchy and role creation |
| **Sidebar** | Customize sidebar menu items and ordering |
| **Field IDs** | Custom field identifiers |
| **User ID** | Username auto-generation format (prefix, numbering, padding) |
| **Action Re-authentication** | Which actions require password re-entry |
| **Audit Templates** | Customize audit logging detail levels |
| **Pagination** | Default page sizes for list views |
| **UNS Configuration** | Unified Namespace settings and ISA-95 level mapping |
| **Help Articles** | In-app help content management |
| **Data Retention** | Telemetry, attribute, and event retention periods |
| **System (Pipeline)** | Ingestion pipeline settings (batch size, concurrency, timeouts) |
| **Login Security** | Account lockout type and duration |
| **Session** | Session duration, idle timeout, warning period |
| **Alarm Columns** | Configure alarm table column visibility per role (11 column definitions) |

---

## Branding

Customize the application's visual identity.

| Setting | Description |
|---------|-------------|
| **Application Name** | Displayed in the header and login page |
| **Logo** | Custom logo image (displayed in sidebar and login) |
| **Favicon** | Browser tab icon |
| **Primary Color** | Theme accent color |

---

## Date & Time

Configure how dates and times are displayed throughout the application.

| Setting | Description |
|---------|-------------|
| **Date Format** | e.g., DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD |
| **Time Format** | 12-hour or 24-hour |
| **Timezone** | Default timezone for display |

---

## Data Retention

Configure how long different types of data are retained before automatic cleanup.

| Data Type | Default Retention | Description |
|-----------|-------------------|-------------|
| **Telemetry** | 90 days | Time-series sensor data |
| **Attributes** | 365 days | Device-reported attributes |
| **Device Events** | 30 days | Connection/disconnection events |
| **Pipeline Traces** | 7 days | Ingestion pipeline debug traces |
| **Audit Trail** | 365 days | System audit records |

A maintenance worker runs periodically to delete data older than the configured retention period.

---

## Pipeline Configuration

Configure the data ingestion pipeline behavior.

| Setting | Default | Description |
|---------|---------|-------------|
| **Batch Size** | 100 | Number of data points per batch write |
| **Flush Interval (ms)** | 1000 | Maximum time between batch flushes |
| **Worker Concurrency** | 10 | Number of concurrent ingestion workers |
| **DLQ Check Interval (s)** | 60 | How often to check the dead letter queue |
| **Connectivity Check (s)** | 60 | How often to check device connectivity |

---

## Backup & Restore

### Database Backup

1. Navigate to **Configuration** → **Backup & Restore**.
2. Click **Create Backup**.
3. The backup includes: all database tables, system configuration, user data.
4. Download the backup file.

### Configuration Restore

1. Navigate to **Configuration** → **Backup & Restore**.
2. Upload a backup file.
3. Select which components to restore.
4. Click **Restore**.

> **Warning:** Restoring a backup overwrites current data. Create a backup before restoring.

---

## System Health

Monitor the platform's operational status.

Navigate to **System Health** from the left sidebar (ADMIN and above).

### Metrics

| Metric | Description |
|--------|-------------|
| **API Requests/min** | Current request throughput |
| **Active Sessions** | Number of currently active user sessions |
| **Queue Depth** | Number of pending messages in the ingestion queue |
| **DLQ Size** | Number of failed messages in the dead letter queue |
| **Database Connections** | Active PostgreSQL connections |
| **MQTT Clients** | Connected MQTT devices |
| **Uptime** | Time since last API restart |

### Health Check

The `/api/health` endpoint returns the API server status:

```bash
curl http://your-server/api/health
# {"status":"ok","timestamp":"2026-03-01T08:00:00.000Z"}
```

---

## Notifications

In-app notifications keep users informed about system events:

| Notification Type | Recipients | Trigger |
|-------------------|-----------|---------|
| **Account Locked** | ADMIN role | User account locked due to failed logins |
| **Password Reset Request** | ADMIN role | User requested a password reset |
| **Alarm Triggered** | Configured roles | Rule chain creates an alarm |
| **System Alert** | SUPER_ADMIN | System health issues |

Access notifications via the bell icon in the top navigation bar.

---

## Config Registry System

DigiLog uses a **self-registering config module architecture** that auto-discovers configuration modules at startup. Instead of hardcoding routes and service methods for each config, modules register themselves with the central registry.

### How It Works

1. Each config module is defined in a single file with metadata (key, label, description, schema, defaults).
2. On startup, the registry auto-discovers all config definition files.
3. Routes, validation, and CRUD operations are generated automatically from the registry.
4. The frontend fetches the registry manifest and renders config pages dynamically.

### Benefits

| Benefit | Description |
|---------|-------------|
| **Zero-Touch Addition** | Add a new config by creating one definition file — no route, service, or frontend changes needed |
| **Consistent Validation** | All configs use Zod schemas from the shared package |
| **Auto-Generated UI** | Modules without custom pages get a functional config UI automatically |
| **23+ Modules** | Currently manages 23+ config modules via the registry |

---

## Field ID Names Configuration

The Field ID Names page allows SUPER_ADMIN users to customize display labels for field identifiers across the application. Fields are organized by module with color-coded tabs for easy navigation.

### Supported Modules (7 modules, 39 fields)

| Module | Fields | Description |
|--------|--------|-------------|
| **User Management** | Username, Email, First Name, Last Name, Phone, Role, Status | User profile and account fields |
| **Audit Trail** | Action, Actor, Target, Timestamp, Details, IP Address | Audit log display columns |
| **Alarms** | Severity, Type, Entity, High Limit, Low Limit, Generated Value, Cleared Value, Status | Alarm table columns |
| **Asset Management** | Name, Template, Parent, Status, Created, Updated | Entity list and detail fields |
| **Notifications** | Title, Message, Type, Recipients, Channel, Status | Notification rule and log fields |
| **Telemetry** | Key, Value, Timestamp, Source, Unit | Time-series data display |
| **Attributes** | Key, Value, Type, Last Updated | Entity attribute fields |

### Features

- **Module Tabs** — Color-coded tabs for quick module switching
- **Search** — Filter fields by name across all modules
- **Inline Edit** — Click to edit display names directly in the table
- **Reset to Default** — Restore original field names per module or globally

---

## Dynamic Config Pages

Config modules that do not have a custom page component (`hasCustomPage: false`) receive an **auto-generated configuration UI** based on their registry metadata.

### Dynamic Page Features

- Form fields generated from the module's Zod schema
- Appropriate input types inferred from schema (text, number, boolean toggle, select)
- Save/reset functionality with validation
- Audit trail integration (all changes logged)

### Custom vs Dynamic Pages

| Aspect | Custom Page | Dynamic Page |
|--------|-------------|--------------|
| **Definition** | `hasCustomPage: true` in registry | `hasCustomPage: false` (default) |
| **UI Control** | Full layout control | Auto-generated from schema |
| **Use Case** | Complex configs (e.g., Branding with image upload) | Simple key-value configs |
| **Examples** | Branding, Password Policy, Alarm Columns | Pagination, Session, Login Security |

---

## Next Steps

- [Security Configuration](../security/security.md) — Password and session policies
- [Backup & Restore API](../../api-reference/backup.md) — Database backup procedures
- [Configuration API](../../api-reference/configuration.md) — Full API reference

---

## Email Notification Configuration

Configure email delivery for notifications.

| Setting | Description |
|---------|-------------|
| **Auth Type** | `oauth2` (recommended) or `basic` |
| **SMTP Host** | SMTP server (e.g., `smtp.office365.com`) |
| **Port** | 587 (STARTTLS) |
| **Secure** | `false` for port 587 STARTTLS |
| **From Email** | Sender email address |
| **From Name** | Sender display name |
| **OAuth2 Provider** | `microsoft` for Office365 |
| **Client ID / Secret** | Azure AD app registration credentials |
| **Tenant ID** | Azure AD tenant (providerTenantId) |

Access via **Notifications** > **Email Settings** in the left sidebar.

See [Email Integration Guide](../notifications/email-integration.md) for full setup.

---

## SMS Notification Configuration

Configure SMS delivery via AWS SNS or other providers.

| Setting | Description |
|---------|-------------|
| **Provider** | `aws-sns`, `twilio`, `vonage`, or `http-gateway` |
| **AWS Access Key** | IAM access key with SNS permissions |
| **AWS Secret Key** | Corresponding secret key |
| **AWS Region** | e.g., `ap-south-1` |
| **Sender ID** | SMS sender name (e.g., `DigiLog`) |
| **Default Country Code** | e.g., `91` for India |

Access via **Notifications** > **SMS Settings** in the left sidebar.

See [SMS Integration Guide](../notifications/sms-integration.md) for full setup.
