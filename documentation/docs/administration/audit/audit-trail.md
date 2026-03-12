# Audit Trail

DigiLog maintains an immutable audit trail that records every significant action performed in the system. This is a core requirement of **21 CFR Part 11** compliance, providing complete traceability of who did what, when, and why.

---

## Audit Trail Concepts

### What is Audited?

Every create, update, delete, and security-related action is recorded:

| Category | Actions Tracked |
|----------|----------------|
| **Authentication** | Login success, login failed, logout, forced logout, session expired |
| **User Management** | User created, updated, disabled, password changed, password reset |
| **Entity Management** | Entity created, updated, deleted, status changed |
| **Relationships** | Parent-child relationships created, deleted |
| **Templates** | Template created, updated, deleted |
| **Alarms** | Alarm acknowledged, cleared (with e-signatures) |
| **Configuration** | System settings changed |
| **Account Security** | Account locked, unlocked, password expired |

### Audit Record Fields

Each audit record contains:

| Field | Description |
|-------|-------------|
| **Timestamp** | Exact time of the action (server time) |
| **User ID** | Username of the person who performed the action |
| **User Role** | Role at the time of the action |
| **Action** | What was done (e.g., `ASSET_CREATED`, `LOGIN_SUCCESS`) |
| **Target Type** | What kind of object was affected (user, asset_instance, session) |
| **Target ID** | The specific object that was affected |
| **Before Value** | State of the object before the change (JSON) |
| **After Value** | State of the object after the change (JSON) |
| **Reason** | Human-readable summary of the change |
| **Signature Meaning** | Purpose of the electronic signature (21 CFR Part 11) |
| **IP Address** | Client IP that made the request |
| **User Agent** | Browser/client information |
| **Session ID** | Active session at the time |

---

## Viewing the Audit Trail

### Audit Trail Page

Navigate to **Audit Trail** from the left sidebar.

The audit trail displays a chronological table with:
- **Time** — When the action occurred
- **User** — Who performed the action
- **Action** — What was done
- **Target** — What was affected
- **Details** — Expandable before/after values

### Filtering

| Filter | Options |
|--------|---------|
| **Date range** | Custom start and end dates |
| **User** | Filter by specific username |
| **Action** | Filter by action type (LOGIN, CREATED, UPDATED, etc.) |
| **Target type** | Filter by entity type |

### Exporting

The audit trail can be exported for compliance documentation and regulatory review.

---

## Electronic Signatures

Per 21 CFR Part 11 §11.50 and §11.70, electronic signatures in DigiLog include:

### Signature Components

1. **Signer identification** — Full name and username of the signer
2. **Date and time** — Timestamp of when the signature was applied
3. **Signature meaning** — The purpose of the signing (e.g., "Alarm acknowledged by operator", "User authenticated with username and password")

### When Signatures are Required

| Action | Signature Meaning |
|--------|------------------|
| **Login** | "User authenticated with username and password" |
| **Password change** | "User changed password" |
| **Alarm acknowledgment** | "Alarm acknowledged by operator" |
| **Alarm clearing** | "Alarm cleared — condition resolved" |
| **Entity creation** | "Entity created" |
| **Entity deletion** | "Entity deactivated" |
| **Configuration change** | "System configuration updated" |

### Signature Verification

For alarm acknowledgment and clearing, users must re-enter their password to provide an electronic signature. This ensures non-repudiation — the signer cannot deny performing the action.

---

## Audit Trail Integrity

### Immutability

Audit records are protected by SHA-256 checksums computed on {timestamp, userId, action, targetType, targetId, afterValue}. Each record's integrity is verified on read (`integrityValid: boolean`). Additionally:
- SUPER_ADMIN can delete audit records (21 CFR Part 11 exemption by design)
- The `audit_trail` table has no update triggers
- Records are retained per the configured retention policy
- Any tampering is detectable via checksum mismatch

### Data Integrity

Each audit record captures the complete before and after state as JSON, enabling:
- **Change detection** — Compare before/after values to see exactly what changed
- **Reconstruction** — Rebuild the state of any object at any point in time
- **Forensic analysis** — Investigate security incidents with full context

---

## Example Audit Records

### Login Success
```json
{
  "action": "LOGIN_SUCCESS",
  "userId": "admin",
  "userRole": "SUPER_ADMIN",
  "targetType": "user",
  "targetId": "abc-123",
  "afterValue": {
    "username": "admin",
    "fullName": "System Administrator"
  },
  "signatureMeaning": "User authenticated with username and password",
  "ipAddress": "192.168.1.100"
}
```

### Entity Updated
```json
{
  "action": "ASSET_UPDATED",
  "userId": "RB0001",
  "userRole": "OPERATOR",
  "targetType": "asset_instance",
  "targetId": "def-456",
  "beforeValue": {
    "name": "Sensor-01",
    "status": "Active"
  },
  "afterValue": {
    "name": "Sensor-01",
    "status": "Maintenance"
  },
  "reason": "Status: \"Active\" → \"Maintenance\"",
  "signatureMeaning": "Entity \"Sensor-01\" updated: Status: \"Active\" → \"Maintenance\""
}
```

### Account Locked
```json
{
  "action": "ACCOUNT_LOCKED",
  "userId": "RB0002",
  "userRole": "ADMIN",
  "targetType": "user",
  "targetId": "ghi-789",
  "afterValue": {
    "username": "RB0002",
    "fullName": "Jane Smith"
  },
  "ipAddress": "10.0.0.50"
}
```

---

## Audit Trail Configuration

### Retention

Configure how long audit records are kept:
- Navigate to **Configuration** → **Data Retention**.
- Set the audit trail retention period (default: 365 days).

### Audit Templates

Customize which actions are logged and what detail level:
- Navigate to **Configuration** → **Audit Templates** (SUPER_ADMIN only).

---

## Next Steps

- [21 CFR Part 11](../../compliance/21-cfr-part-11.md) — Compliance requirements
- [Security Configuration](../security/security.md) — Password and login policies
- [Roles & Permissions](../roles/roles-and-permissions.md) — Who can do what
