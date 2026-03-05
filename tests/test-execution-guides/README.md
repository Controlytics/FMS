# DigiLog Manual Test Cases — Master Index

## Project Information
- **Application**: DigiLog (21 CFR Part 11 Compliant Digital Logbook)
- **Version**: DataIngestion branch
- **App URL**: http://3.108.185.106
- **API Base URL**: http://3.108.185.106/api (or http://localhost:3000/api from server)
- **Swagger UI**: http://3.108.185.106/docs

---

## Test Case Summary

| # | Feature | TC File | EG File | Positive | Negative | Total | Priority |
|---|---------|---------|---------|----------|----------|-------|----------|
| 01 | Authentication | [TC-01](../manual-test-cases/TC-01-authentication.md) | — | 10 | 8 | 18 | Critical |
| 17 | Data Retention | [TC-17](../manual-test-cases/TC-17-retention.md) | [EG-17](./EG-17-retention.md) | 9 | 8 | 17 | High |
| 18 | Connectivity | [TC-18](../manual-test-cases/TC-18-connectivity.md) | [EG-18](./EG-18-connectivity.md) | 10 | 7 | 17 | High |
| 19 | QR Codes | [TC-19](../manual-test-cases/TC-19-qr-codes.md) | [EG-19](./EG-19-qr-codes.md) | 7 | 7 | 14 | Medium |
| 20 | Help Articles | [TC-20](../manual-test-cases/TC-20-help-articles.md) | [EG-20](./EG-20-help-articles.md) | 10 | 7 | 17 | High |
| 21 | Debug Traces | [TC-21](../manual-test-cases/TC-21-debug-traces.md) | [EG-21](./EG-21-debug-traces.md) | 11 | 5 | 16 | High |
| 22 | Backup & Restore | [TC-22](../manual-test-cases/TC-22-backup-restore.md) | [EG-22](./EG-22-backup-restore.md) | 8 | 7 | 15 | Critical |
| 23 | Session Management | [TC-23](../manual-test-cases/TC-23-session-management.md) | [EG-23](./EG-23-session-management.md) | 9 | 6 | 15 | Critical |
| 24 | File Uploads | [TC-24](../manual-test-cases/TC-24-uploads.md) | [EG-24](./EG-24-uploads.md) | 7 | 7 | 14 | Medium |
| | **TOTALS (TC-17 through TC-24)** | | | **71** | **54** | **125** | |

---

## How to Use These Test Cases

### Test Case Files (TC-XX-*.md)
Each TC file contains:
- **Overview**: Module, endpoints, permissions, dependencies
- **Positive Test Cases** (TC-XX-P01, P02, ...): Tests that verify correct behavior
- **Negative Test Cases** (TC-XX-N01, N02, ...): Tests that verify error handling, security, and edge cases

Each test case includes:
- **Priority**: High, Medium, or Low
- **Preconditions**: Required state before running the test
- **Test Data**: Specific payloads, credentials, or configurations needed
- **Steps**: Numbered sequence of actions
- **Expected Result**: What success looks like

### Execution Guide Files (EG-XX-*.md)
Each EG file mirrors its corresponding TC file and adds:
- **Prerequisites**: Exact setup commands
- **Authentication Setup**: Copy-paste bash commands to get JWT tokens
- **API (curl)**: Ready-to-run curl commands for each test
- **Browser Steps**: UI-level instructions for frontend testing
- **Pass/Fail Checklists**: Checkbox criteria for marking tests complete
- **Cleanup**: Commands to restore the system to its original state

### Recommended Workflow
1. Open the TC file to understand what you are testing
2. Open the corresponding EG file side-by-side
3. Run the Authentication Setup commands from the EG file
4. Execute tests in order (positive first, then negative)
5. Check off pass/fail criteria as you go
6. Run cleanup commands when done

---

## Prerequisites

### Credentials
| Role | Username | Password | Notes |
|------|----------|----------|-------|
| SUPER_ADMIN | admin | Test@12345 | Full access, all permissions |
| ADMIN | admin_user | Admin@123 | Create via /users if needed |
| SUPERVISOR | supervisor_user | Supervisor@123 | Create via /users if needed |
| OPERATOR | operator_user | Operator@123 | Create via /users if needed |
| VIEWER | viewer_user | Viewer@123 | Create via /users if needed |

### Tools Required
- **curl**: For API testing (all EG files use curl commands)
- **jq**: For JSON pretty-printing and field extraction
- **Browser**: Chrome or Firefox for UI testing
- **psql**: For database verification queries (session/backup tests)
- **mosquitto_pub** (optional): For MQTT connectivity tests

### Environment
- **Server**: SSH via `ssh -i ~/Downloads/21cfrbook.pem ubuntu@3.108.185.106`
- **API Port**: 3000 (direct), 80 (via nginx)
- **Database**: PostgreSQL 16 on localhost:5432, database `digilog_db`
- **TimescaleDB**: PostgreSQL 16 on localhost:5432, database `digilog_tsdb`
- **Redis**: localhost:6379
- **EMQX**: MQTT on 1883, Dashboard at :18083

---

## Quick Reference

### Authentication Pattern
```bash
# Get JWT token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345"}' | jq -r '.token')
```

### Common Request Patterns

**GET with Auth:**
```bash
curl -s -X GET http://localhost:3000/api/<endpoint> \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**POST with JSON Body:**
```bash
curl -s -X POST http://localhost:3000/api/<endpoint> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}' | jq .
```

**PUT with JSON Body:**
```bash
curl -s -X PUT http://localhost:3000/api/<endpoint> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}' | jq .
```

**DELETE:**
```bash
curl -s -X DELETE http://localhost:3000/api/<endpoint> \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**File Upload (multipart):**
```bash
curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/file.jpg;type=image/jpeg" | jq .
```

**Status Code Only:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X GET http://localhost:3000/api/<endpoint> \
  -H "Authorization: Bearer $TOKEN"
```

### Device Token Authentication (Data Ingestion)
```bash
# Device tokens authenticate via the same Bearer header
DEVICE_TOKEN="<64-char-hex-token>"

curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60}'
```

### Common Entity Setup
```bash
# Get first entity ID
ENTITY_ID=$(curl -s -X GET "http://localhost:3000/api/assets/instances?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

# Generate device token for entity
DEVICE_TOKEN=$(curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.token')
```

### Database Queries
```bash
# Connect to main database
psql -d digilog_db -U postgres

# Connect to TimescaleDB
psql -d digilog_tsdb -U postgres
```

---

## API Endpoint Reference by Test Case

### TC-17: Retention
| Method | Endpoint | Role Required |
|--------|----------|---------------|
| GET | /api/config/retention | SUPER_ADMIN |
| PUT | /api/config/retention | SUPER_ADMIN |
| POST | /api/retention/archive | SUPER_ADMIN |
| POST | /api/retention/execute | SUPER_ADMIN |
| POST | /api/retention/execute-range | SUPER_ADMIN, ADMIN |
| POST | /api/retention/delete-keys | SUPER_ADMIN, ADMIN |
| POST | /api/retention/delete-records | SUPER_ADMIN, ADMIN |

### TC-18: Connectivity
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/connectivity/:entityId | ASSET_VIEW |
| POST | /api/connectivity/:entityId/test | ASSET_VIEW |
| GET | /api/connectivity/:entityId/snippets | ASSET_VIEW |
| POST | /api/connectivity/:entityId/token | SUPER_ADMIN, ADMIN |
| DELETE | /api/connectivity/:entityId/token | SUPER_ADMIN, ADMIN |
| GET | /api/connectivity/:entityId/history | ASSET_VIEW |

### TC-19: QR Codes
| Method | Endpoint | Role Required |
|--------|----------|---------------|
| POST | /api/qr/:entityId/generate | SUPER_ADMIN, ADMIN, SUPERVISOR |
| GET | /api/qr/:entityId | ASSET_VIEW |
| GET | /api/qr/:entityId/svg | ASSET_VIEW |
| DELETE | /api/qr/:entityId | SUPER_ADMIN, ADMIN |

### TC-20: Help Articles
| Method | Endpoint | Role Required |
|--------|----------|---------------|
| GET | /api/help | Any authenticated |
| GET | /api/help/:key | Any authenticated |
| POST | /api/help | SUPER_ADMIN (reauth) |
| PUT | /api/help/:id | SUPER_ADMIN (reauth) |
| DELETE | /api/help/:id | SUPER_ADMIN (reauth) |
| GET | /api/help/:id/versions | SUPER_ADMIN, ADMIN |

### TC-21: Debug Traces
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/debug/traces | READ_DEBUG_TRACE |
| GET | /api/debug/traces/stats | READ_DEBUG_TRACE |
| GET | /api/debug/traces/:id | READ_DEBUG_TRACE |
| PUT | /api/debug/traces/entity/:entityId/toggle | MANAGE_DEBUG_TRACE |

### TC-22: Backup & Restore
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/backup/export | CONFIG_UPDATE (reauth) |
| POST | /api/backup/restore | CONFIG_UPDATE (reauth) |
| POST | /api/backup/validate | CONFIG_UPDATE |

### TC-23: Session Management
| Method | Endpoint | Notes |
|--------|----------|-------|
| POST | /api/auth/login | Creates session |
| POST | /api/auth/logout | Terminates session |
| GET | /api/auth/me | Extends session (sliding window) |
| POST | /api/auth/change-password | Terminates other sessions |
| GET | /api/config/session | Session config |
| PUT | /api/config/session | Update session config |

### TC-24: File Uploads
| Method | Endpoint | Auth Required |
|--------|----------|---------------|
| POST | /api/uploads/photo | Yes (any role) |
| GET | /uploads/:filename | No (public) |

---

## Test Execution Order

For a complete regression test, execute in this recommended order:

1. **TC-23** Session Management (foundational — ensures auth works)
2. **TC-24** File Uploads (standalone feature)
3. **TC-22** Backup & Restore (export a backup before other tests modify data)
4. **TC-20** Help Articles (standalone CRUD)
5. **TC-19** QR Codes (requires entities)
6. **TC-18** Connectivity (requires entities, generates device tokens)
7. **TC-21** Debug Traces (requires connectivity + telemetry data)
8. **TC-17** Data Retention (run last — deletes data)

---

## Notes

- **SUPER_ADMIN Audit Exemption**: SUPER_ADMIN actions are NOT logged in the audit trail per 21 CFR Part 11 design. Test audit trail entries with non-SUPER_ADMIN accounts.
- **Reauth**: Some endpoints require re-authentication. In curl, this is handled by the token; in the browser, a reauth dialog appears. If reauth is disabled for an action, the operation proceeds without a dialog.
- **Soft Delete**: Entity templates and instances use soft delete (isActive=false). Help articles also use soft delete. QR codes and relationships use hard delete.
- **Single Session**: Each user can only have one active session. A new login invalidates the previous session's token.
- **TimescaleDB**: Retention and trace queries run against the `digilog_tsdb` database, not the main `digilog_db`.
