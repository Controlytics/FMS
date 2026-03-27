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
| 01 | Authentication | [TC-01](../manual-test-cases/TC-01-authentication.md) | [EG-01](./EG-01-authentication.md) | 10 | 8 | 18 | Critical |
| 02 | User Management | [TC-02](../manual-test-cases/TC-02-user-management.md) | [EG-02](./EG-02-user-management.md) | 11 | 8 | 19 | Critical |
| 03 | Roles & Permissions | [TC-03](../manual-test-cases/TC-03-roles-permissions.md) | [EG-03](./EG-03-roles-permissions.md) | 8 | 7 | 15 | High |
| 04 | Entity Templates | [TC-04](../manual-test-cases/TC-04-entity-templates.md) | [EG-04](./EG-04-entity-templates.md) | 9 | 4 | 13 | High |
| 05 | Entity Instances | [TC-05](../manual-test-cases/TC-05-entity-instances.md) | [EG-05](./EG-05-entity-instances.md) | 8 | 6 | 14 | High |
| 06 | Entity Relationships | [TC-06](../manual-test-cases/TC-06-entity-relationships.md) | [EG-06](./EG-06-entity-relationships.md) | 8 | 5 | 13 | High |
| 07 | Entity Identifiers | [TC-07](../manual-test-cases/TC-07-entity-identifiers.md) | [EG-07](./EG-07-entity-identifiers.md) | 9 | 5 | 14 | Medium |
| 08 | Configuration | [TC-08](../manual-test-cases/TC-08-configuration.md) | [EG-08](./EG-08-configuration.md) | 16 | 8 | 24 | High |
| 09 | Audit Trail | [TC-09](../manual-test-cases/TC-09-audit-trail.md) | [EG-09](./EG-09-audit-trail.md) | 13 | 9 | 22 | Critical |
| 10 | Notifications | [TC-10](../manual-test-cases/TC-10-notifications.md) | [EG-10](./EG-10-notifications.md) | 12 | 6 | 18 | High |
| 11 | Data Ingestion | [TC-11](../manual-test-cases/TC-11-data-ingestion.md) | [EG-11](./EG-11-data-ingestion.md) | 9 | 7 | 16 | Critical |
| 12 | Rule Chains | [TC-12](../manual-test-cases/TC-12-rule-chains.md) | [EG-12](./EG-12-rule-chains.md) | 17 | 5 | 22 | High |
| 13 | UNS | [TC-13](../manual-test-cases/TC-13-uns.md) | [EG-13](./EG-13-uns.md) | 6 | 7 | 13 | Medium |
| 14 | Telemetry Queries | [TC-14](../manual-test-cases/TC-14-telemetry-queries.md) | [EG-14](./EG-14-telemetry-queries.md) | 12 | 7 | 19 | High |
| 15 | Alarms | [TC-15](../manual-test-cases/TC-15-alarms.md) | [EG-15](./EG-15-alarms.md) | 11 | 9 | 20 | Critical |
| 16 | Export | [TC-16](../manual-test-cases/TC-16-export.md) | [EG-16](./EG-16-export.md) | 13 | 6 | 19 | High |
| 17 | Data Retention | [TC-17](../manual-test-cases/TC-17-retention.md) | [EG-17](./EG-17-retention.md) | 9 | 8 | 17 | High |
| 18 | Connectivity | [TC-18](../manual-test-cases/TC-18-connectivity.md) | [EG-18](./EG-18-connectivity.md) | 10 | 7 | 17 | High |
| 19 | QR Codes | [TC-19](../manual-test-cases/TC-19-qr-codes.md) | [EG-19](./EG-19-qr-codes.md) | 7 | 7 | 14 | Medium |
| 20 | Help Articles | [TC-20](../manual-test-cases/TC-20-help-articles.md) | [EG-20](./EG-20-help-articles.md) | 10 | 7 | 17 | High |
| 21 | Debug Traces | [TC-21](../manual-test-cases/TC-21-debug-traces.md) | [EG-21](./EG-21-debug-traces.md) | 11 | 5 | 16 | High |
| 22 | Backup & Restore | [TC-22](../manual-test-cases/TC-22-backup-restore.md) | [EG-22](./EG-22-backup-restore.md) | 8 | 7 | 15 | Critical |
| 23 | Session Management | [TC-23](../manual-test-cases/TC-23-session-management.md) | [EG-23](./EG-23-session-management.md) | 9 | 6 | 15 | Critical |
| 24 | File Uploads | [TC-24](../manual-test-cases/TC-24-uploads.md) | [EG-24](./EG-24-uploads.md) | 7 | 7 | 14 | Medium |
| 25 | 21 CFR Compliance | [TC-25](../manual-test-cases/TC-25-21cfr-compliance.md) | [EG-25](./EG-25-21cfr-compliance.md) | 18 | 6 | 24 | Critical |
| | **TOTALS (TC-01 through TC-25)** | | | **253** | **164** | **417** | |

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
| SUPER_ADMIN | admin | Admin@123 | Full access, all permissions |
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
  -d '{"username":"admin","password":"Admin@123"}' | jq -r '.token')
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

### TC-01: Authentication (8 endpoints)
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | /api/auth/login | None (rate limited 10/min) |
| POST | /api/auth/logout | Bearer JWT |
| POST | /api/auth/beacon-logout | None (token in body) |
| GET | /api/auth/me | Bearer JWT |
| PUT | /api/auth/profile | Bearer JWT |
| POST | /api/auth/change-password | Bearer JWT |
| POST | /api/auth/verify | Bearer JWT |
| POST | /api/auth/forgot-password | None (rate limited 5/5min) |

### TC-02: User Management (14 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/users | ADMIN+ |
| GET | /api/users/stats | ADMIN+ |
| POST | /api/users | ADMIN+ (reauth) |
| GET | /api/users/:id | ADMIN+ |
| PUT | /api/users/:id | ADMIN+ (reauth) |
| DELETE | /api/users/:id | SUPER_ADMIN (reauth) |
| POST | /api/users/bulk-delete | SUPER_ADMIN (reauth) |
| POST | /api/users/:id/enable | ADMIN+ (reauth) |
| POST | /api/users/:id/disable | ADMIN+ (reauth) |
| POST | /api/users/:id/unlock | ADMIN+ (reauth) |
| POST | /api/users/:id/reset-password | ADMIN+ (reauth) |
| GET | /api/users/reset-requests | ADMIN+ |
| GET | /api/users/reset-requests/pending | ADMIN+ |
| POST | /api/users/reset-requests/:id/process | ADMIN+ (reauth) |

### TC-03: Roles & Permissions (8 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/roles | ADMIN+ |
| GET | /api/roles/active | Any authenticated |
| GET | /api/roles/:name | ADMIN+ |
| GET | /api/roles/permissions/all | SUPER_ADMIN |
| GET | /api/roles/:name/creatable | ADMIN+ |
| POST | /api/roles | SUPER_ADMIN (reauth) |
| PUT | /api/roles/:name | SUPER_ADMIN (reauth) |
| DELETE | /api/roles/:name | SUPER_ADMIN (reauth) |

### TC-04: Entity Templates (6 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/assets/templates | ASSET_VIEW |
| GET | /api/assets/templates/:id | ASSET_VIEW |
| POST | /api/assets/templates | ASSET_TEMPLATE_MANAGE (reauth) |
| PUT | /api/assets/templates/:id | ASSET_TEMPLATE_MANAGE (reauth) |
| DELETE | /api/assets/templates/:id | ASSET_TEMPLATE_MANAGE (reauth) |
| GET | /api/assets/templates/:id/versions | ASSET_VIEW |

### TC-05: Entity Instances (8 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/assets/instances | ASSET_VIEW |
| GET | /api/assets/instances/tree | ASSET_VIEW |
| GET | /api/assets/instances/:id | ASSET_VIEW |
| POST | /api/assets/instances | ASSET_CREATE (reauth) |
| PUT | /api/assets/instances/:id | ASSET_UPDATE (reauth) |
| PATCH | /api/assets/instances/:id/status | ASSET_UPDATE (reauth) |
| DELETE | /api/assets/instances/:id | ASSET_DELETE (reauth) |
| GET | /api/assets/instances/:id/children | ASSET_VIEW |

### TC-06: Entity Relationships (3 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/assets/relationships | ASSET_VIEW |
| POST | /api/assets/relationships | ASSET_RELATIONSHIP_MANAGE (reauth) |
| DELETE | /api/assets/relationships/:id | ASSET_RELATIONSHIP_MANAGE (reauth) |

### TC-07: Entity Identifiers (4 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/assets/identifiers | ASSET_VIEW |
| GET | /api/assets/identifiers/lookup/:value | ASSET_VIEW |
| POST | /api/assets/identifiers | ASSET_IDENTIFIER_MANAGE (reauth) |
| DELETE | /api/assets/identifiers/:id | ASSET_IDENTIFIER_MANAGE (reauth) |

### TC-08: Configuration (36+ endpoints)
See CLAUDE.md for full endpoint listing.

### TC-09: Audit Trail (4 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/audit | Any authenticated |
| GET | /api/audit/:id | Any authenticated |
| DELETE | /api/audit/:id | SUPER_ADMIN |
| POST | /api/audit/bulk-delete | SUPER_ADMIN |

### TC-10: Notifications (9 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/notifications | Any authenticated |
| GET | /api/notifications/unread-count | Any authenticated |
| PUT | /api/notifications/:id/read | Any authenticated |
| PUT | /api/notifications/:id/unread | Any authenticated |
| PUT | /api/notifications/mark-all-read | Any authenticated |
| PUT | /api/notifications/bulk-read | Any authenticated |
| PUT | /api/notifications/bulk-unread | Any authenticated |
| DELETE | /api/notifications/:id | Any authenticated |
| POST | /api/notifications/bulk-delete | SUPER_ADMIN |

### TC-11: Data Ingestion (8 endpoints)
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | /api/data/telemetry | Device token |
| POST | /api/data/attributes | Device token |
| GET | /api/data/attributes | Device token |
| POST | /api/data/checklist | User JWT |
| POST | /api/data/event | Device token |
| POST | /api/data/rpc | User JWT |
| GET | /api/data/rpc/response/:requestId | User JWT |
| POST | /api/data/batch | Device token |

### TC-12: Rule Chains (14 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/rule-chains | RULE_CHAIN_MANAGE |
| GET | /api/rule-chains/node-types | RULE_CHAIN_MANAGE |
| GET | /api/rule-chains/:id | RULE_CHAIN_MANAGE |
| POST | /api/rule-chains | RULE_CHAIN_MANAGE (reauth) |
| PUT | /api/rule-chains/:id | RULE_CHAIN_MANAGE (reauth) |
| DELETE | /api/rule-chains/:id | RULE_CHAIN_MANAGE |
| POST | /api/rule-chains/:id/nodes | RULE_CHAIN_MANAGE |
| PUT | /api/rule-chains/:id/nodes/:nodeId | RULE_CHAIN_MANAGE |
| DELETE | /api/rule-chains/:id/nodes/:nodeId | RULE_CHAIN_MANAGE |
| POST | /api/rule-chains/:id/connections | RULE_CHAIN_MANAGE |
| DELETE | /api/rule-chains/:id/connections/:connId | RULE_CHAIN_MANAGE |
| POST | /api/rule-chains/:id/save | RULE_CHAIN_MANAGE (reauth) |
| GET | /api/rule-chains/:id/debug | RULE_CHAIN_MANAGE |
| DELETE | /api/rule-chains/:id/debug | RULE_CHAIN_MANAGE |

### TC-13: UNS (6 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/uns/tree | SUPER_ADMIN/ADMIN/SUPERVISOR |
| GET | /api/uns/entity/:entityId | ASSET_VIEW |
| PUT | /api/uns/entity/:entityId | SUPER_ADMIN (reauth) |
| POST | /api/uns/entity/:entityId/move | SUPER_ADMIN/ADMIN |
| POST | /api/uns/entity/:entityId/move/confirm | SUPER_ADMIN/ADMIN |
| GET | /api/uns/search | ASSET_VIEW |

### TC-14: Telemetry Queries (7 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/telemetry/:entityId/latest | ASSET_VIEW |
| GET | /api/telemetry/:entityId/timeseries | ASSET_VIEW |
| GET | /api/telemetry/:entityId/keys | ASSET_VIEW |
| GET | /api/attributes/:entityId/:scope | ASSET_VIEW |
| GET | /api/attributes/:entityId/history | ASSET_VIEW |
| GET | /api/checklist/:entityId/responses | ASSET_VIEW |
| GET | /api/checklist/:entityId/history | ASSET_VIEW |

### TC-15: Alarms (5 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/alarms | ASSET_VIEW |
| GET | /api/alarms/summary | ASSET_VIEW |
| GET | /api/alarms/:entityId | ASSET_VIEW |
| POST | /api/alarms/:id/acknowledge | ALARM_MANAGE (reauth) |
| POST | /api/alarms/:id/clear | ALARM_MANAGE (reauth) |

### TC-16: Export (5 endpoints)
| Method | Endpoint | Permission |
|--------|----------|------------|
| GET | /api/export/telemetry/:entityId | ASSET_VIEW |
| GET | /api/export/alarms | ASSET_VIEW |
| GET | /api/export/attributes/:entityId | ASSET_VIEW |
| GET | /api/export/checklist/:entityId | ASSET_VIEW |
| GET | /api/export/status/:jobId | ASSET_VIEW |

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

1. **TC-01** Authentication (foundational — ensures login works)
2. **TC-23** Session Management (session lifecycle, idle timeout)
3. **TC-02** User Management (CRUD users for subsequent tests)
4. **TC-03** Roles & Permissions (RBAC setup)
5. **TC-08** Configuration (system settings)
6. **TC-22** Backup & Restore (export a backup before other tests modify data)
7. **TC-04** Entity Templates (template blueprints)
8. **TC-05** Entity Instances (create entities)
9. **TC-06** Entity Relationships (link entities)
10. **TC-07** Entity Identifiers (physical IDs)
11. **TC-19** QR Codes (requires entities)
12. **TC-18** Connectivity (requires entities, generates device tokens)
13. **TC-11** Data Ingestion (send telemetry/attributes)
14. **TC-12** Rule Chains (processing pipeline)
15. **TC-13** UNS (ISA-95 namespace)
16. **TC-14** Telemetry Queries (read back data)
17. **TC-15** Alarms (alarm lifecycle)
18. **TC-16** Export (CSV/JSON export)
19. **TC-09** Audit Trail (verify audit integrity)
20. **TC-10** Notifications (notification lifecycle)
21. **TC-20** Help Articles (standalone CRUD)
22. **TC-21** Debug Traces (requires connectivity + telemetry data)
23. **TC-24** File Uploads (standalone feature)
24. **TC-25** 21 CFR Compliance (cross-cutting regulatory validation)
25. **TC-17** Data Retention (run last — deletes data)

---

## Notes

- **SUPER_ADMIN Audit Exemption**: SUPER_ADMIN actions are NOT logged in the audit trail per 21 CFR Part 11 design. Test audit trail entries with non-SUPER_ADMIN accounts.
- **Reauth**: Some endpoints require re-authentication. In curl, this is handled by the token; in the browser, a reauth dialog appears. If reauth is disabled for an action, the operation proceeds without a dialog.
- **Soft Delete**: Entity templates and instances use soft delete (isActive=false). Help articles also use soft delete. QR codes and relationships use hard delete.
- **Single Session**: Each user can only have one active session. A new login invalidates the previous session's token.
- **TimescaleDB**: Retention and trace queries run against the `digilog_tsdb` database, not the main `digilog_db`.


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

