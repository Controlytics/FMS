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

## Next Steps

- [Security Configuration](../security/security.md) — Password and session policies
- [Backup & Restore](backup-restore.md) — Database backup procedures
- [System Health](system-health.md) — Monitoring and diagnostics
