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

**Permission:** `NOTIFICATION_MANAGE`

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
