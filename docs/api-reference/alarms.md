# Alarms API

The Alarms API provides endpoints for querying, acknowledging, and clearing alarms. Alarms are created automatically by the rule engine when configured threshold conditions are met.

---

## Querying Alarms

### GET /api/queries/alarms

List alarms with filtering, sorting, and pagination.

```bash
curl "http://your-server/api/queries/alarms?\
status=ACTIVE&severity=CRITICAL&page=1&limit=50" \
  -H "Authorization: Bearer USER_TOKEN"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | `ACTIVE`, `ACKNOWLEDGED`, or `CLEARED` |
| `severity` | string | `CRITICAL`, `MAJOR`, `MINOR`, `WARNING`, or `INFO` |
| `entityId` | UUID | Filter by entity |
| `alarmType` | string | Filter by alarm type (e.g., `HIGH_TEMP`) |
| `from` | ISO 8601 | Start date |
| `to` | ISO 8601 | End date |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 50, max: 200) |
| `sortBy` | string | `createdAt`, `severity`, or `status` |
| `sortDir` | string | `asc` or `desc` |

**Response (200):**
```json
{
  "data": [
    {
      "id": "alarm-uuid",
      "entityId": "entity-uuid",
      "alarmType": "HIGH_TEMP",
      "severity": "CRITICAL",
      "status": "ACTIVE",
      "details": { "temperature": 105.2 },
      "acknowledged": false,
      "cleared": false,
      "createdAt": "2026-03-01T08:15:00Z"
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 50,
  "totalPages": 1
}
```

**Permission:** `ASSET_VIEW`

---

### GET /api/queries/alarms/summary

Get alarm count summary for dashboard display.

```bash
GET /api/queries/alarms/summary
```

**Response (200):**
```json
{
  "active": 5,
  "acknowledged": 12,
  "cleared": 89,
  "critical": 2
}
```

**Permission:** `ASSET_VIEW`

---

### GET /api/queries/alarms/:entityId

List alarms for a specific entity.

```bash
GET /api/queries/alarms/ENTITY_UUID?status=ACTIVE&severity=CRITICAL
```

**Permission:** `ASSET_VIEW`

---

## Alarm Actions

### POST /api/queries/alarms/:id/acknowledge

Acknowledge an active alarm with an electronic signature (21 CFR Part 11 compliant).

**Request:**
```bash
curl -X POST "http://your-server/api/queries/alarms/ALARM_UUID/acknowledge" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signerFullName": "John Smith",
    "meaning": "Alarm reviewed and operator notified",
    "remarks": "Temperature spike due to ambient conditions"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `signerFullName` | string | Yes | Full name of the signer |
| `meaning` | string | Yes | Meaning of the signature (why acknowledging) |
| `remarks` | string | No | Additional remarks |

**Response (200):**
```json
{
  "alarm": {
    "id": "alarm-uuid",
    "status": "ACKNOWLEDGED",
    "acknowledged": true,
    "acknowledgedBy": "john.smith",
    "acknowledgedAt": "2026-03-01T08:30:00Z",
    "ackRemarks": "Temperature spike due to ambient conditions"
  },
  "signature": {
    "id": "sig-uuid",
    "recordType": "alarm",
    "recordId": "alarm-uuid",
    "signerFullName": "John Smith",
    "signerRole": "SUPERVISOR",
    "meaning": "Alarm reviewed and operator notified",
    "signedAt": "2026-03-01T08:30:00Z",
    "recordHash": "sha256...",
    "signatureHash": "sha256..."
  }
}
```

> **Electronic Signature:** The signature includes a SHA-256 hash chain linking the signer identity, timestamp, and alarm record. This meets §11.50 (signature manifestations) and §11.70 (signature/record linking).

**Role Required:** `SUPER_ADMIN`, `ADMIN`, or `SUPERVISOR`

---

### POST /api/queries/alarms/:id/clear

Clear an active or acknowledged alarm with an electronic signature.

**Request:**
```bash
curl -X POST "http://your-server/api/queries/alarms/ALARM_UUID/clear" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signerFullName": "John Smith",
    "meaning": "Root cause resolved — cooling system repaired",
    "remarks": "Replaced faulty fan unit"
  }'
```

Same parameters as acknowledge. The alarm must be in `ACTIVE` or `ACKNOWLEDGED` status.

**Role Required:** `SUPER_ADMIN`, `ADMIN`, or `SUPERVISOR`

---

## Alarm Lifecycle

```
[Rule Engine triggers alarm]
        │
        ▼
     ACTIVE ──────► ACKNOWLEDGED ──────► CLEARED
        │                                    ▲
        └────────────────────────────────────┘
              (direct clear without ack)
```

| Transition | Who | Requires |
|------------|-----|----------|
| → ACTIVE | System | Rule engine `create-alarm` node |
| ACTIVE → ACKNOWLEDGED | SUPERVISOR+ | Electronic signature |
| ACTIVE → CLEARED | SUPERVISOR+ | Electronic signature |
| ACKNOWLEDGED → CLEARED | SUPERVISOR+ | Electronic signature |

---

## Alarm Severity Levels

| Severity | Priority | Description |
|----------|----------|-------------|
| `CRITICAL` | 1 (highest) | Immediate action required |
| `MAJOR` | 2 | Significant issue requiring attention |
| `MINOR` | 3 | Minor issue to be tracked |
| `WARNING` | 4 | Potential issue to monitor |
| `INFO` | 5 (lowest) | Informational, no action needed |

---

## Next Steps

- [Alarms User Guide](../user-guide/alarms/alarms.md) — Alarm concepts and configuration
- [Rule Engine](../user-guide/rule-engine/overview.md) — Alarm rule creation
- [Entity API](entities.md) — Entity management
