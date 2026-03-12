# Notifications API

The Notifications API provides endpoints for listing, reading, and managing in-app notifications. Notifications are created automatically by the system for events like alarms, password reset requests, and rule chain alerts.

---

## List Notifications

### GET /api/notifications

Retrieve paginated notifications for the current user.

```bash
curl "http://your-server/api/notifications?page=1&limit=20&isRead=false&period=week" \
  -H "Authorization: Bearer USER_TOKEN"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 20, max: 100) |
| `isRead` | string | `"true"` or `"false"` — filter by read status |
| `period` | string | `today`, `week`, `month`, `quarter`, `year`, `all` |
| `startDate` | ISO 8601 | Custom range start |
| `endDate` | ISO 8601 | Custom range end |

**Response (200):**
```json
{
  "data": [
    {
      "id": "notif-uuid",
      "type": "ALARM_TRIGGERED",
      "title": "Critical Alarm",
      "message": "High temperature alarm on Sensor TP-42",
      "isRead": false,
      "readAt": null,
      "createdAt": "2026-03-01T08:15:00Z"
    }
  ],
  "total": 25,
  "unreadCount": 3,
  "page": 1,
  "limit": 20,
  "totalPages": 2
}
```

**Visibility rules:**
- `SUPER_ADMIN` sees all notifications
- `ADMIN` sees all except SUPER_ADMIN-targeted notifications
- Other roles see only their own notifications

---

## Unread Count

### GET /api/notifications/unread-count

Quick count for notification badge display.

```json
{ "count": 3 }
```

---

## Read Status Management

### PUT /api/notifications/:id/read

Mark a single notification as read.

### PUT /api/notifications/:id/unread

Mark a single notification as unread.

### PUT /api/notifications/mark-all-read

Mark all visible notifications as read for the current user.

### PUT /api/notifications/bulk-read

Mark multiple notifications as read.

```bash
curl -X PUT "http://your-server/api/notifications/bulk-read" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["notif-1", "notif-2", "notif-3"] }'
```

### PUT /api/notifications/bulk-unread

Mark multiple notifications as unread.

---

## Delete Notifications

### DELETE /api/notifications/:id

Delete a single notification.

### POST /api/notifications/bulk-delete

Delete multiple notifications.

```bash
curl -X POST "http://your-server/api/notifications/bulk-delete" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["notif-1", "notif-2"] }'
```

**Permission:** SUPER_ADMIN only (bulk-delete)

---

## Notification Types

| Type | Description | Created By |
|------|-------------|------------|
| `ALARM_TRIGGERED` | New alarm created | Rule engine |
| `ALARM_CLEARED` | Alarm cleared | User action |
| `PASSWORD_RESET_REQUEST` | User requested password reset | User action |
| `PASSWORD_RESET_PROCESSED` | Reset request approved/rejected | Admin action |
| `ACCOUNT_LOCKED` | Account locked after failed attempts | System |
| `CONFIG_CHANGED` | System configuration updated | Admin action |
| `BACKUP_CREATED` | Database backup exported | Admin action |
| `BACKUP_RESTORED` | Database restored from backup | Admin action |
| `RULE_CHAIN_ALERT` | Rule chain `send-notification` node | Rule engine |
| `ENTITY_STATUS_CHANGED` | Entity status changed | User/system |
| `USER_CREATED` | New user account created | Admin action |
| `TEMPLATE_UPDATED` | Template version updated | Admin action |

---

## Next Steps

- [Alarms API](alarms.md) — Alarm management
- [User Management API](users.md) — User operations
- [System Configuration](configuration.md) — Notification settings

---

## Email & SMS Notification Delivery

### Multi-Channel Delivery

DigiLog supports multi-channel notification delivery through configurable rules:

| Channel | Provider | Status |
|---------|----------|--------|
| **Email** | Office365 (OAuth2 / Basic Auth) via SMTP | Active |
| **SMS** | AWS SNS (also Twilio, Vonage, HTTP Gateway) | Active (Sandbox) |
| **In-App** | Built-in notification system | Active |

### Notification Rules API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notification-rules` | GET | List all notification rules |
| `/api/notification-rules` | POST | Create a new rule |
| `/api/notification-rules/:id` | PUT | Update a rule |
| `/api/notification-rules/:id` | DELETE | Delete a rule |

### Notification Settings API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notification-settings/email` | GET | Get email config |
| `/api/notification-settings/email` | PUT | Update email config |
| `/api/notification-settings/email/test` | POST | Send test email |
| `/api/notification-settings/email/oauth2/callback` | POST | OAuth2 token exchange |
| `/api/notification-settings/sms` | GET | Get SMS config |
| `/api/notification-settings/sms` | PUT | Update SMS config |
| `/api/notification-settings/sms/test` | POST | Send test SMS |

### Notification Templates API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notification-templates` | GET | List all templates |
| `/api/notification-templates` | POST | Create a template |
| `/api/notification-templates/:id` | PUT | Update a template |
| `/api/notification-templates/:id` | DELETE | Delete a template |

### Supported Event Types (14)

| Event Type | Trigger | Key Variables |
|------------|---------|---------------|
| `ALARM_CREATED` | New alarm | alarmType, severity, entityName, unsPath, triggerCondition, alarmId, timestamp |
| `ALARM_ACKNOWLEDGED` | Alarm acknowledged | alarmType, severity, acknowledgedBy, remarks, alarmId, timestamp |
| `ALARM_CLEARED` | Alarm cleared | alarmType, severity, clearedBy, remarks, alarmId, timestamp |
| `DEVICE_ONLINE` | Device connects | deviceName, unsPath, protocol, sourceIp, timestamp |
| `DEVICE_OFFLINE` | Device disconnects | deviceName, unsPath, timestamp |
| `DEVICE_INACTIVITY` | Timeout | deviceName, unsPath, inactiveSince, timeoutSeconds, timestamp |
| `USER_LOGIN` | User logs in | username, fullName, role, ipAddress, timestamp |
| `USER_CREATED` | New user | username, fullName, email, role, createdBy, timestamp |
| `USER_LOCKED` | Account locked | username, fullName, reason, failedAttempts, ipAddress, timestamp |
| `RULE_CHAIN_TRIGGERED` | Rule executes | ruleChainName, entityName, nodesExecuted, durationMs, timestamp |
| `CHECKLIST_SUBMITTED` | Checklist submit | checklistName, entityName, submittedBy, timestamp |
| `CHECKLIST_APPROVED` | Checklist approved | checklistName, approvedBy, timestamp |
| `CHECKLIST_REJECTED` | Checklist rejected | checklistName, rejectedBy, reason, timestamp |
| `SYSTEM_ERROR` | 500 error | errorType, errorMessage, url, timestamp |

### Dynamic Templates

The "All Events (Combined)" template dynamically adapts to each event type:
- **Email**: Uses `${details}` variable - HTML table with event-specific fields only
- **SMS**: Uses `${smsDetails}` variable - plain-text list of event-specific fields

### See Also
- [Email Integration Guide](../../administration/notifications/email-integration.md)
- [SMS Integration Guide](../../administration/notifications/sms-integration.md)
