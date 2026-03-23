# Testing Guide

## Test Infrastructure
- **Framework:** Vitest (74 test files, 16,530 lines)
- **Location:** `apps/api/src/**/__tests__/`
- **Run:** `npm run test` from root

## Manual Test Scenarios

### 1. Login Flow
- [ ] Login with valid credentials → redirects to dashboard
- [ ] Login with wrong password → shows error with attempts remaining
- [ ] Login 5 times wrong → account locks
- [ ] Login from second tab → session conflict dialog
- [ ] Force login → terminates old session
- [ ] SUPER_ADMIN login with LDAP enabled → still uses local auth
- [ ] LDAP user login → authenticates via LDAP server
- [ ] Expired password → redirected to change-password

### 2. User Management
- [ ] SUPER_ADMIN creates TENANT_ADMIN with tenant assignment
- [ ] TENANT_ADMIN creates users (cannot create TENANT_ADMIN)
- [ ] Edit user → change role, org assignment
- [ ] Disable user → cannot login
- [ ] Lock user → unlock with temp password
- [ ] Bulk delete users

### 3. Organization Management
- [ ] Create organization with name + slug
- [ ] Edit organization name/description
- [ ] Deactivate org → users cannot login
- [ ] Delete org → users/entities unassigned (not deleted)
- [ ] Org detail → view users, entities, templates tabs

### 4. Entity/Asset Management
- [ ] Create template with attributes, telemetry keys, alarm rules
- [ ] Create entity from template
- [ ] Assign entity to organization
- [ ] Create entity relationships (parent-child)
- [ ] Generate QR code for entity
- [ ] Scan QR → opens entity detail

### 5. Rule Chain
- [ ] Create new rule chain
- [ ] Add nodes (filter, transform, action)
- [ ] Connect nodes with edges
- [ ] Configure each node
- [ ] Save and activate
- [ ] Test with sample data → verify execution path
- [ ] Debug mode → check execution traces

### 6. Data Ingestion
- [ ] HTTP POST telemetry → stored in TimescaleDB
- [ ] MQTT publish → telemetry ingested
- [ ] Invalid device token → rejected
- [ ] Rate limit exceeded → throttled
- [ ] Template alarm rule triggers → alarm created

### 7. Notifications
- [ ] In-app notification → badge count updates
- [ ] Mark as read → count decreases
- [ ] Email notification → delivered to inbox
- [ ] Notification rule triggers on alarm

### 8. LDAP Integration
- [ ] Configure LDAP → test connection (success/failure)
- [ ] LDAP user first login → auto-provisioned
- [ ] LDAP group → role mapping works
- [ ] Disable LDAP → local auth restored
- [ ] SUPER_ADMIN always local auth

## Edge Cases
- Login with empty username/password
- Create user with duplicate email
- Delete org with active users
- Submit telemetry with invalid JSON
- Rule chain with infinite loop (cycle detection)
- Concurrent sessions from same user
- Password that doesn't meet policy
- File upload exceeding 5MB limit

## API Testing
Use Swagger UI at `/docs` or:
```bash
# Health check
curl http://localhost:3000/api/health

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"password"}'
```
