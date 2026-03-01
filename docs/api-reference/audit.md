# Audit Trail API

The Audit Trail API provides read access to the immutable audit log. Every system action is automatically recorded with who, what, when, and before/after values, meeting 21 CFR Part 11 §11.10(e) requirements.

---

## Query Audit Trail

### GET /api/audit

Retrieve paginated audit records with filtering and sorting.

```bash
curl "http://your-server/api/audit?\
period=week&action=LOGIN&sortBy=timestamp&sortOrder=desc&page=1&limit=20" \
  -H "Authorization: Bearer USER_TOKEN"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 20, max: 100) |
| `period` | string | `today`, `week`, `month`, `quarter`, `year`, `all` |
| `startDate` | ISO 8601 | Custom range start |
| `endDate` | ISO 8601 | Custom range end |
| `search` | string | Search across userId, action, targetType, targetId |
| `userId` | string | Filter by user ID |
| `action` | string | Filter by action type |
| `targetType` | string | Filter by target entity type |
| `sortBy` | string | `timestamp`, `action`, `userId`, `userRole` |
| `sortOrder` | string | `asc` or `desc` (default: desc) |

**Response (200):**
```json
{
  "data": [
    {
      "id": 1042,
      "userId": "admin",
      "userRole": "SUPER_ADMIN",
      "action": "UPDATE_ENTITY",
      "targetType": "AssetInstance",
      "targetId": "entity-uuid",
      "beforeValue": { "status": "Active" },
      "afterValue": { "status": "Maintenance" },
      "reason": "Scheduled maintenance",
      "signatureMeaning": null,
      "ipAddress": "192.168.1.100",
      "timestamp": "2026-03-01T08:00:00Z",
      "integrityValid": true
    }
  ],
  "total": 1042,
  "page": 1,
  "limit": 20,
  "totalPages": 53
}
```

**All authenticated users** can query the audit trail.

---

### GET /api/audit/:id

Get full detail for a single audit record including checksum and session information.

**Response includes additional fields:**
- `userAgent` — Browser/client user agent
- `sessionId` — Session that performed the action
- `checksum` — SHA-256 integrity hash
- `previousChecksum` — Hash of the previous record (hash chain)
- `integrityValid` — Whether the checksum verification passed

---

## Integrity Verification

Each audit record contains a SHA-256 checksum computed from:
- Record content (action, userId, values, timestamp)
- Previous record's checksum (hash chain)

The `integrityValid` field indicates whether the checksum matches the expected value. A failed verification suggests the record may have been tampered with.

---

## Audit Record Deletion

> **Warning:** Deleting audit records breaks the hash chain integrity for subsequent records. This should only be done in exceptional circumstances.

### DELETE /api/audit/:id

Delete a single audit record. Temporarily disables the 21 CFR Part 11 delete trigger.

**Permission:** `CONFIG_UPDATE`

### POST /api/audit/bulk-delete

Delete multiple audit records.

```bash
curl -X POST "http://your-server/api/audit/bulk-delete" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": [1, 2, 3] }'
```

**Permission:** `CONFIG_UPDATE`

---

## Audit Action Types

| Action | Target Type | Description |
|--------|-------------|-------------|
| `LOGIN` | Session | User logged in |
| `LOGOUT` | Session | User logged out |
| `LOGIN_FAILED` | User | Failed login attempt |
| `CHANGE_PASSWORD` | User | Password changed |
| `CREATE_USER` | User | New user created |
| `UPDATE_USER` | User | User profile updated |
| `DELETE_USER` | User | User deleted |
| `ENABLE_USER` | User | User account enabled |
| `DISABLE_USER` | User | User account disabled |
| `UNLOCK_USER` | User | User account unlocked |
| `RESET_PASSWORD` | User | Admin-initiated password reset |
| `CREATE_ENTITY` | AssetInstance | Entity created |
| `UPDATE_ENTITY` | AssetInstance | Entity updated |
| `DELETE_ENTITY` | AssetInstance | Entity deleted |
| `CREATE_TEMPLATE` | AssetTemplate | Template created |
| `UPDATE_TEMPLATE` | AssetTemplate | Template updated |
| `DELETE_TEMPLATE` | AssetTemplate | Template deleted |
| `ACKNOWLEDGE_ALARM` | Alarm | Alarm acknowledged (e-signature) |
| `CLEAR_ALARM` | Alarm | Alarm cleared (e-signature) |
| `UPDATE_CONFIG` | SystemConfig | Configuration changed |
| `EXPORT_BACKUP` | Backup | Backup exported |
| `RESTORE_BACKUP` | Backup | Backup restored |

---

## Next Steps

- [Audit Trail Guide](../administration/audit/audit-trail.md) — Audit trail concepts
- [21 CFR Part 11](../compliance/21-cfr-part-11.md) — Compliance mapping
- [Authentication API](authentication.md) — Session management
